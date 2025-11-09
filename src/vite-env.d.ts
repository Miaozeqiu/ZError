/// <reference types="vite/client" />

// Tauri API类型声明
declare global {
  interface Window {
    __TAURI__?: {
      sql?: {
        load: (path: string) => Promise<any>;
      };
      invoke?: (cmd: string, args?: any) => Promise<any>;
    };
    __TAURI_INTERNALS__?: any;
  }
}

export {};

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
