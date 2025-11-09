import base64
import os
import pickle
import sys
import json
import requests
import urllib3

# 禁用不安全请求的警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 获取应用程序的基础路径
def get_base_path():
    # 如果是PyInstaller打包的程序
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    # 如果是直接运行的脚本
    return os.path.dirname(os.path.abspath(__file__))

# 请求头
Headers = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "SignCheck": "935465b771e207fd0f22f5c49ec70381",
    "TimeDate": "1694747726000",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
}

# OCR服务地址
OCR_HOST = "http://127.0.0.1:5255"

# 会话存储文件路径
def get_sessions_file():
    return os.path.join(get_base_path(), "sessions.json")

# 加载会话信息
def load_sessions():
    sessions_file = get_sessions_file()
    if os.path.exists(sessions_file):
        try:
            with open(sessions_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"加载会话文件失败: {e}")
    return {}

# 保存会话信息
def save_session(username, cookies_dict):
    sessions = load_sessions()
    sessions[username] = cookies_dict
    
    try:
        with open(get_sessions_file(), 'w', encoding='utf-8') as f:
            json.dump(sessions, f, ensure_ascii=False, indent=2)
        print(f"会话信息已保存到 {get_sessions_file()}")
        return True
    except Exception as e:
        print(f"保存会话信息失败: {e}")
        return False

def get_captcha() -> dict:
    """获取验证码信息"""
    captcha_headers = {
        "User-Agent": "Mozilla/5.0(WindowsNT10.0;Win64;x64)AppleWebKit/537.36(KHTML,likeGecko)Chrome/98.0.4758.102Safari/537.36",
    }
    # 禁用SSL证书验证
    response = requests.get(
        "https://centro.zjlll.net/ajax?&service=/centro/api/authcode/create&params=",
        headers=captcha_headers,
        verify=False
    )
    captcha = response.json()["data"]
    return captcha

def recognize_captcha(image_data):
    """使用本地OCR服务识别验证码"""
    try:
        # 使用OCR服务识别验证码
        api_url = f"{OCR_HOST}/recognize_captcha"
        resp = requests.post(
            api_url, 
            json={
                "image_base64": base64.b64encode(image_data).decode()
            }
        )
        
        # 检查响应
        if resp.status_code == 200:
            result = resp.json()
            if result.get("code") == 0:
                captcha_code = result.get("captcha_code")
                print(f"OCR服务识别结果: {captcha_code}")
                return captcha_code
            else:
                print(f"OCR服务返回错误: {result.get('message')}")
                return None
        else:
            print(f"OCR服务返回错误状态码: {resp.status_code}, {resp.text}")
            return None
    except Exception as e:
        print(f"调用OCR服务失败: {e}")
        return None

def check_session_valid(cookies_dict):
    """检查会话是否有效"""
    try:
        session = requests.Session()
        session.verify = False
        
        # 将字典形式的cookies转换为RequestsCookieJar
        for name, value in cookies_dict.items():
            session.cookies.set(name, value)
        
        # 尝试获取用户信息
        params = {"service": "/centro/api/user/getProfile", "params[withDetail]": True}
        response = session.get(
            "https://www.zjooc.cn/ajax", params=params, headers=Headers
        )
        data = response.json()
        return data.get("resultCode") == 0 and "data" in data
    except Exception:
        return False

def login(username, pwd):
    """登录并保存会话"""
    # 检查是否已有该账号的会话信息
    sessions = load_sessions()
    if username in sessions:
        cookies_dict = sessions[username]
        if check_session_valid(cookies_dict):
            print(f"使用已保存的会话信息登录成功")
            print(f"账号 {username} 的会话信息:")
            print(json.dumps(cookies_dict, indent=2, ensure_ascii=False))
            return True
        else:
            print("保存的会话已过期，需要重新登录")
    
    session = requests.Session()
    session.verify = False
    
    # 获取验证码
    captcha_data = get_captcha()
    captcha_id = captcha_data["id"]
    
    # 识别验证码
    image_data = base64.b64decode(captcha_data["image"])
    
    # 尝试使用本地OCR服务识别验证码
    captcha_code = recognize_captcha(image_data)
    
    # 如果OCR服务识别失败，保存图片并提示手动输入
    if not captcha_code:
        # 保存验证码图片
        img_path = os.path.join(get_base_path(), "captcha.jpg")
        with open(img_path, "wb") as f:
            f.write(image_data)
        print(f"验证码图片已保存到: {img_path}")
        captcha_code = input("请查看图片并输入验证码: ")
    else:
        print(f"验证码: {captcha_code}")
    input()
    # 登录数据
    login_data = {
        "login_name": username,
        "password": pwd,
        "captchaCode": captcha_code,
        "captchaId": captcha_id,
        "redirect_url": "https://www.zjooc.cn",
        "app_key": "0f4cbab4-84ee-48c3-ba4c-874578754b29",
        "utoLoginTime": "7",
    }
    
    try:
        # 发送登录请求
        login_res = session.post(
            "https://centro.zjlll.net/login/doLogin", data=login_data
        ).json()
        
        # 检查登录结果
        if login_res.get("resultCode", 1) != 0:
            error_msg = login_res.get("resultMsg", "登录失败，请检查账号密码和验证码")
            print(f"登录失败: {error_msg}")
            return False
            
        # 完成登录流程
        login_param = {
            "auth_code": login_res.get("authorization_code", ""),
            "autoLoginTime": "7",
        }
        session.get("https://www.zjooc.cn/autoLogin", params=login_param)
        print("登录成功")
        
        # 验证会话是否有效
        params = {"service": "/centro/api/user/getProfile", "params[withDetail]": True}
        response = session.get(
            "https://www.zjooc.cn/ajax", params=params, headers=Headers
        )
        data = response.json()
        
        if data.get("resultCode") != 0 or "data" not in data:
            print("会话验证失败")
            return False
            
        # 将cookies转换为字典并保存
        cookies_dict = {name: value for name, value in session.cookies.items()}
        save_session(username, cookies_dict)
        
        # 打印会话信息
        print(f"账号 {username} 的会话信息:")
        print(json.dumps(cookies_dict, indent=2, ensure_ascii=False))
        
        return True
        
    except Exception as ex:
        print(f"登录过程中出现异常: {ex}")
        return False

def list_accounts():
    """列出所有已保存的账号"""
    sessions = load_sessions()
    if not sessions:
        print("没有保存的账号信息")
        return
    
    print("已保存的账号列表:")
    for username in sessions.keys():
        valid = "有效" if check_session_valid(sessions[username]) else "已过期"
        print(f"- {username} ({valid})")

if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "list":
        # 列出所有已保存的账号
        list_accounts()
    elif len(sys.argv) == 2 and sys.argv[1] == "show":
        # 显示所有账号的详细信息
        sessions = load_sessions()
        print(json.dumps(sessions, indent=2, ensure_ascii=False))
    elif len(sys.argv) == 3:
        # 登录指定账号
        username = sys.argv[1]
        password = sys.argv[2]
        
        if login(username, password):
            print("登录并保存会话成功")
        else:
            print("登录失败")
            sys.exit(1)
    else:
        print("使用方法:")
        print("  python login.py 用户名 密码    - 登录指定账号")
        print("  python login.py list          - 列出所有已保存的账号")
        print("  python login.py show          - 显示所有账号的详细会话信息")
        sys.exit(1)