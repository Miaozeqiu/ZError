/* Native WebKitGTK frame identities and isolated fixed-operation transport.
 * The channel is WebKitUserMessage IPC, never page JavaScript or postMessage.
 */
#include <webkit2/webkit-web-extension.h>
#include <jsc/jsc.h>
#include <gmodule.h>
#include <string.h>

#define MAX_FRAMES 128
#define MAX_REPLY (128 * 1024)
#define PAGE_STATE "zerror-document-state"
#define STALE "页面文档已更换，请重新读取后操作"

typedef struct {
    GWeakRef frame;
    gchar *id;
    gchar *loader;
} Frame;

typedef struct {
    GHashTable *frames;
    GHashTable *pending;
    GWeakRef main_frame;
} Page;

typedef struct {
    gint references;
    GWeakRef page;
    GWeakRef frame;
    WebKitUserMessage *message;
    gchar *loader;
    gchar *url;
    gint64 deadline;
    guint timeout;
    gboolean done;
} Request;

static WebKitScriptWorld *world;
static gchar *process_id;

static void reply(WebKitUserMessage *message, gboolean ok, const gchar *text)
{
    WebKitUserMessage *response = webkit_user_message_new(
        "zerror.documents.reply", g_variant_new("(bs)", ok, text));
    webkit_user_message_send_reply(message, response);
    /* send_reply sinks the floating reference. */
}

static void frame_free(gpointer data)
{
    Frame *frame = data;
    g_weak_ref_clear(&frame->frame);
    g_free(frame->id);
    g_free(frame->loader);
    g_free(frame);
}

static gchar *frame_id(WebKitFrame *frame)
{
    return g_strdup_printf("gtk:%s:%" G_GUINT64_FORMAT, process_id, webkit_frame_get_id(frame));
}

static JSCValue *evaluate(JSCContext *context, const gchar *source)
{
    jsc_context_clear_exception(context);
    JSCValue *value = jsc_context_evaluate(context, source, -1);
    if (jsc_context_get_exception(context)) {
        jsc_context_clear_exception(context);
        g_clear_object(&value);
    }
    return value;
}

/* Window identity equality is allowed across origins; no cross-origin DOM is
 * read in the parent. The native frame's own isolated world performs its work.
 * A detached frame is excluded even if WebKit still retains its Frame object.
 */
static gboolean connected(WebKitWebPage *page, WebKitFrame *frame)
{
    Page *state = g_object_get_data(G_OBJECT(page), PAGE_STATE);
    WebKitFrame *main = state ? g_weak_ref_get(&state->main_frame) : NULL;
    if (!main) return FALSE;
    JSCContext *root = webkit_frame_get_js_context_for_script_world(main, world);
    JSCContext *child = webkit_frame_get_js_context_for_script_world(frame, world);
    g_object_unref(main);
    if (!root || !child) {
        g_clear_object(&root);
        g_clear_object(&child);
        return FALSE;
    }
    JSCValue *test = evaluate(root,
        "target=>{let count=0;const walk=(w,depth)=>{"
        "if(depth>16||++count>128)throw Error('Frame limit');"
        "let found=w===target;for(let i=0;i<w.length;i++)found=walk(w[i],depth+1)||found;"
        "return found;};return walk(window,0);}");
    JSCValue *window = jsc_context_get_global_object(child);
    JSCValue *result = test ? jsc_value_function_callv(test, 1, &window) : NULL;
    gboolean ok = result && !jsc_context_get_exception(root) && jsc_value_to_boolean(result);
    jsc_context_clear_exception(root);
    g_clear_object(&result);
    g_clear_object(&test);
    g_object_unref(window);
    g_object_unref(root);
    g_object_unref(child);
    return ok;
}

static Frame *current(WebKitWebPage *page, WebKitFrame *frame, const gchar *loader, const gchar *url)
{
    Page *state = g_object_get_data(G_OBJECT(page), PAGE_STATE);
    g_autofree gchar *id = frame_id(frame);
    Frame *row = state ? g_hash_table_lookup(state->frames, id) : NULL;
    if (!row || g_strcmp0(row->loader, loader) || g_strcmp0(webkit_frame_get_uri(frame), url))
        return NULL;
    if (!connected(page, frame)) return NULL;
    /* Creating a world can emit window-object-cleared and replace the row. */
    row = g_hash_table_lookup(state->frames, id);
    return row && !g_strcmp0(row->loader, loader) ? row : NULL;
}

static Request *request_ref(Request *request)
{
    request->references++;
    return request;
}

static void request_unref(gpointer data)
{
    Request *request = data;
    if (--request->references) return;
    g_weak_ref_clear(&request->page);
    g_weak_ref_clear(&request->frame);
    g_clear_object(&request->message);
    g_free(request->loader);
    g_free(request->url);
    g_free(request);
}

static void finish(Request *request, gboolean ok, const gchar *text)
{
    if (request->done) return;
    request->done = TRUE;
    if (strlen(text) > MAX_REPLY) {
        ok = FALSE;
        text = "文档回执超过大小限制，请缩小读取范围";
    }
    reply(request->message, ok, text);
    g_clear_object(&request->message);
    if (request->timeout) {
        g_source_remove(request->timeout);
        request->timeout = 0;
    }
    WebKitWebPage *page = g_weak_ref_get(&request->page);
    Page *state = page ? g_object_get_data(G_OBJECT(page), PAGE_STATE) : NULL;
    if (state) g_hash_table_remove(state->pending, request);
    g_clear_object(&page);
}

static gboolean expired(gpointer data)
{
    /* Evaluating liveness can run microtasks and finish the same request. */
    Request *request = request_ref(data);
    WebKitWebPage *page = g_weak_ref_get(&request->page);
    WebKitFrame *frame = g_weak_ref_get(&request->frame);
    gboolean stale = !page || !frame || !current(page, frame, request->loader, request->url);
    g_clear_object(&frame);
    g_clear_object(&page);
    if (request->done) { request_unref(request); return G_SOURCE_REMOVE; }
    if (!stale && g_get_monotonic_time() < request->deadline) {
        request_unref(request);
        return G_SOURCE_CONTINUE;
    }
    request->timeout = 0;
    finish(request, FALSE, stale ? STALE : "Linux 文档操作超时");
    request_unref(request);
    return G_SOURCE_REMOVE;
}

static void resolved(const gchar *json, gpointer data)
{
    Request *request = data;
    if (request->done) return;
    WebKitWebPage *page = g_weak_ref_get(&request->page);
    WebKitFrame *frame = g_weak_ref_get(&request->frame);
    if (!page || !frame || !current(page, frame, request->loader, request->url))
        finish(request, FALSE, STALE);
    else if (!json)
        finish(request, FALSE, "页面拒绝了文档操作");
    else
        finish(request, TRUE, json);
    g_clear_object(&frame);
    g_clear_object(&page);
}

static void page_free(gpointer data)
{
    Page *state = data;
    GHashTableIter iter;
    gpointer value;
    g_hash_table_iter_init(&iter, state->pending);
    while (g_hash_table_iter_next(&iter, NULL, &value)) {
        Request *request = value;
        request->done = TRUE;
        if (request->message) reply(request->message, FALSE, STALE);
        g_clear_object(&request->message);
        if (request->timeout) g_source_remove(request->timeout);
        request->timeout = 0;
    }
    g_hash_table_unref(state->pending);
    g_hash_table_unref(state->frames);
    g_weak_ref_clear(&state->main_frame);
    g_free(state);
}

static void window_cleared(WebKitScriptWorld *script_world, WebKitWebPage *page,
                           WebKitFrame *frame, gpointer data)
{
    (void)script_world;
    (void)data;
    Page *state = g_object_get_data(G_OBJECT(page), PAGE_STATE);
    if (!state) return;
    /* Navigation invalidates outstanding observations promptly, including waits
     * whose JavaScript promise disappeared with the previous document. */
    GList *requests = g_hash_table_get_values(state->pending);
    for (GList *item = requests; item; item = item->next) request_ref(item->data);
    for (GList *item = requests; item; item = item->next) {
        Request *request = item->data;
        WebKitFrame *owner = g_weak_ref_get(&request->frame);
        if (webkit_frame_is_main_frame(frame) || owner == frame) finish(request, FALSE, STALE);
        g_clear_object(&owner);
    }
    g_list_free_full(requests, request_unref);
    if (webkit_frame_is_main_frame(frame)) {
        g_weak_ref_set(&state->main_frame, frame);
        g_hash_table_remove_all(state->frames);
    }
    g_autofree gchar *id = frame_id(frame);
    /* Weak frame references do not retain detached documents or JavaScript worlds. */
    GHashTableIter iter;
    gpointer value;
    g_hash_table_iter_init(&iter, state->frames);
    while (g_hash_table_iter_next(&iter, NULL, &value)) {
        WebKitFrame *live = g_weak_ref_get(&((Frame *)value)->frame);
        if (!live) g_hash_table_iter_remove(&iter);
        g_clear_object(&live);
    }
    if (g_hash_table_size(state->frames) >= MAX_FRAMES && !g_hash_table_contains(state->frames, id))
        return;
    Frame *entry = g_new0(Frame, 1);
    entry->id = g_strdup(id);
    entry->loader = g_uuid_string_random();
    g_weak_ref_init(&entry->frame, frame);
    g_hash_table_replace(state->frames, g_strdup(id), entry);
}

static gchar *json_string(const gchar *text)
{
    GString *json = g_string_new("\"");
    for (const guchar *p = (const guchar *)(text ? text : ""); *p; p++) {
        if (*p == '"' || *p == '\\') g_string_append_c(json, '\\');
        if (*p < 0x20) g_string_append_printf(json, "\\u%04x", *p);
        else g_string_append_c(json, *p);
    }
    g_string_append_c(json, '"');
    return g_string_free(json, FALSE);
}

static gpointer copy_key(gconstpointer key, gpointer data)
{
    (void)data;
    return g_strdup(key);
}

static void list(WebKitWebPage *page, WebKitUserMessage *message)
{
    Page *state = g_object_get_data(G_OBJECT(page), PAGE_STATE);
    WebKitFrame *main = g_weak_ref_get(&state->main_frame);
    if (!main) { reply(message, FALSE, STALE); return; }
    JSCContext *context = webkit_frame_get_js_context_for_script_world(main, world);
    g_clear_object(&context);
    GString *result = g_string_new("[");
    /* Root first, regardless of hash iteration order. Copy keys before touching worlds. */
    GList *borrowed = g_hash_table_get_keys(state->frames);
    GList *keys = g_list_copy_deep(borrowed, copy_key, NULL);
    g_list_free(borrowed);
    g_autofree gchar *main_id = frame_id(main);
    g_object_unref(main);
    for (guint pass = 0; pass < 2; pass++) {
        for (GList *item = keys; item; item = item->next) {
            Frame *row = g_hash_table_lookup(state->frames, item->data);
            if (!row || ((!g_strcmp0(row->id, main_id)) != (pass == 0))) continue;
            WebKitFrame *frame = g_weak_ref_get(&row->frame);
            if (frame && connected(page, frame)) {
                row = g_hash_table_lookup(state->frames, item->data);
                if (!row) { g_object_unref(frame); continue; }
                g_autofree gchar *id = json_string(row->id);
                g_autofree gchar *loader = json_string(row->loader);
                g_autofree gchar *url = json_string(webkit_frame_get_uri(frame));
                g_string_append_printf(result, "%s{\"frameId\":%s,\"loaderId\":%s,\"url\":%s}",
                    result->len > 1 ? "," : "", id, loader, url);
            } else g_hash_table_remove(state->frames, item->data);
            g_clear_object(&frame);
        }
    }
    g_list_free_full(keys, g_free);
    g_string_append_c(result, ']');
    if (result->len > MAX_REPLY) reply(message, FALSE, "页面包含过多文档");
    else reply(message, TRUE, result->str);
    g_string_free(result, TRUE);
}

static void child_frame(WebKitWebPage *page, WebKitFrame *parent, const gchar *selector,
                         WebKitUserMessage *message)
{
    JSCContext *context = webkit_frame_get_js_context_for_script_world(parent, world);
    g_autofree gchar *quoted = json_string(selector);
    g_autofree gchar *script = g_strdup_printf(
        "(()=>{const nodes=document.querySelectorAll(%s);"
        "return nodes.length===1&&/^(IFRAME|FRAME)$/.test(nodes[0].tagName)"
        "?target=>nodes[0].isConnected&&nodes[0].contentWindow===target:()=>false;})()", quoted);
    JSCValue *test = evaluate(context, script);
    if (!test) {
        g_object_unref(context);
        reply(message, FALSE, "无效的 iframe 选择器");
        return;
    }
    Page *state = g_object_get_data(G_OBJECT(page), PAGE_STATE);
    GList *borrowed = g_hash_table_get_keys(state->frames);
    GList *keys = g_list_copy_deep(borrowed, copy_key, NULL);
    g_list_free(borrowed);
    gchar *found = NULL;
    for (GList *item = keys; item && !found; item = item->next) {
        Frame *row = g_hash_table_lookup(state->frames, item->data);
        WebKitFrame *frame = row ? g_weak_ref_get(&row->frame) : NULL;
        if (frame && frame != parent && connected(page, frame)) {
            JSCContext *child = webkit_frame_get_js_context_for_script_world(frame, world);
            JSCValue *window = jsc_context_get_global_object(child);
            JSCValue *result = jsc_value_function_callv(test, 1, &window);
            if (!jsc_context_get_exception(context) && jsc_value_to_boolean(result))
                found = json_string(item->data);
            jsc_context_clear_exception(context);
            g_object_unref(result);
            g_object_unref(window);
            g_object_unref(child);
        }
        g_clear_object(&frame);
    }
    reply(message, TRUE, found ? found : "null");
    g_free(found);
    g_list_free_full(keys, g_free);
    g_object_unref(test);
    g_object_unref(context);
}

static gboolean received(WebKitWebPage *page, WebKitUserMessage *message, gpointer data)
{
    (void)data;
    const gchar *name = webkit_user_message_get_name(message);
    gboolean is_list = !g_strcmp0(name, "zerror.documents.list");
    gboolean is_child = !g_strcmp0(name, "zerror.documents.child");
    gboolean is_eval = !g_strcmp0(name, "zerror.documents.evaluate");
    if (!is_list && !is_child && !is_eval) return FALSE;
    GVariant *parameters = webkit_user_message_get_parameters(message);
    if (!parameters || !g_variant_is_of_type(parameters, G_VARIANT_TYPE("(ssss)"))) {
        reply(message, FALSE, "无效的文档参数"); return TRUE;
    }
    const gchar *id, *loader, *url, *payload;
    g_variant_get(parameters, "(&s&s&s&s)", &id, &loader, &url, &payload);
    if (strlen(payload) > 256 * 1024 || strlen(id) > 256 || strlen(loader) > 128 || strlen(url) > 8192) {
        reply(message, FALSE, "文档参数超过大小限制"); return TRUE;
    }
    if (is_list) { list(page, message); return TRUE; }
    Page *state = g_object_get_data(G_OBJECT(page), PAGE_STATE);
    Frame *entry = g_hash_table_lookup(state->frames, id);
    WebKitFrame *frame = entry ? g_weak_ref_get(&entry->frame) : NULL;
    if (!frame || !current(page, frame, loader, url)) {
        g_clear_object(&frame);
        reply(message, FALSE, STALE); return TRUE;
    }
    if (is_child) {
        if (strlen(payload) > 512) reply(message, FALSE, "iframe 选择器过长");
        else child_frame(page, frame, payload, message);
        g_object_unref(frame);
        return TRUE;
    }
    if (g_hash_table_size(state->pending) >= 32) {
        g_object_unref(frame);
        reply(message, FALSE, "文档请求过多"); return TRUE;
    }
    Request *request = g_new0(Request, 1);
    request->references = 1;
    g_weak_ref_init(&request->page, page);
    g_weak_ref_init(&request->frame, frame);
    request->message = g_object_ref(message);
    request->loader = g_strdup(loader);
    request->url = g_strdup(url);
    g_hash_table_insert(state->pending, request, request_ref(request));
    request->deadline = g_get_monotonic_time() + 34 * G_TIME_SPAN_SECOND;
    /* Detached documents may suspend JS timers without destroying their world.
     * Observe native liveness only while a request is outstanding. */
    request->timeout = g_timeout_add_full(G_PRIORITY_DEFAULT, 500, expired,
        request_ref(request), request_unref);
    JSCContext *context = webkit_frame_get_js_context_for_script_world(frame, world);
    JSCValue *callback = jsc_value_new_function(context, NULL, G_CALLBACK(resolved),
        request_ref(request), request_unref, G_TYPE_NONE, 1, G_TYPE_STRING);
    g_autofree gchar *script = g_strdup_printf(
        "done=>{Promise.resolve().then(()=> (%s)).then("
        "value=>done(JSON.stringify({value})),()=>done(null));}", payload);
    JSCValue *function = evaluate(context, script);
    if (!function) finish(request, FALSE, "页面拒绝了文档操作");
    else {
        JSCValue *result = jsc_value_function_callv(function, 1, &callback);
        g_clear_object(&result);
        if (jsc_context_get_exception(context)) finish(request, FALSE, "页面拒绝了文档操作");
    }
    jsc_context_clear_exception(context);
    g_clear_object(&function);
    g_object_unref(callback);
    g_object_unref(context);
    g_object_unref(frame);
    request_unref(request);
    return TRUE;
}

static void page_created(WebKitWebExtension *extension, WebKitWebPage *page, gpointer data)
{
    (void)extension;
    (void)data;
    Page *state = g_new0(Page, 1);
    g_weak_ref_init(&state->main_frame, NULL);
    state->frames = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, frame_free);
    state->pending = g_hash_table_new_full(g_direct_hash, g_direct_equal, NULL, request_unref);
    g_object_set_data_full(G_OBJECT(page), PAGE_STATE, state, page_free);
    g_signal_connect(page, "user-message-received", G_CALLBACK(received), NULL);
}

G_MODULE_EXPORT void webkit_web_extension_initialize(WebKitWebExtension *extension)
{
    process_id = g_uuid_string_random();
    world = webkit_script_world_new_with_name("zerror-document-v2");
    g_signal_connect(world, "window-object-cleared", G_CALLBACK(window_cleared), NULL);
    g_signal_connect(extension, "page-created", G_CALLBACK(page_created), NULL);
}
