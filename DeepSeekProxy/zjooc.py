import base64
from itertools import chain
from pprint import pprint
import os
import pickle
import json
import sys

import ddddocr
import html2text
import requests

# 获取应用程序的基础路径
def get_base_path():
    # 如果是PyInstaller打包的程序
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    # 如果是直接运行的脚本
    return os.path.dirname(os.path.abspath(__file__))

Headers = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "SignCheck": "935465b771e207fd0f22f5c49ec70381",
    "TimeDate": "1694747726000",
    # 这里的TimeDate 和 SignCheck 是时间戳和加密后的token
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/111.0.0.0 Safari/537.36",
}


def get_captcha() -> dict:  # 获取验证码信息
    captcha_headers = {
        "User-Agent": "Mozilla/5.0(WindowsNT10.0;Win64;x64)AppleWebKit/537.36(KHTML,likeGecko)Chrome/98.0.4758.102Safari/537.36",
    }
    captcha = requests.get(
        "https://centro.zjlll.net/ajax?&service=/centro/api/authcode/create&params=",
        headers=captcha_headers,
    ).json()["data"]
    #    img_bytes = base64.b64de(b64_img)
    #   with open("test.jpg", 'wb') as f:
    #         f.write(img_bytes)
    return captcha

def check_right_answer(obj):
    # 检查 obj 是否存在以及其结构是否符合预期
    if not obj or 'data' not in obj or not isinstance(obj['data'], dict) or 'paperSubjectList' not in obj['data']:
        return False
    
    # 获取 paperSubjectList
    paper_subject_list = obj['data']['paperSubjectList']
    
    # 确保 paperSubjectList 是一个列表
    if not isinstance(paper_subject_list, list):
        return False
    
    # 遍历 paperSubjectList
    for subject in paper_subject_list:
        if 'rightAnswer' in subject:
            return True
        # 如果有子题目，则检查子题目
        if 'childrenList' in subject:
            for child in subject['childrenList']:
                if 'rightAnswer' in child:
                    return True
    
    return False

token = 'f37ed30cac9401574db782fede3f1ceec1dcb102266f6946e0fcce6329080e8b979f5fa877e4e53d8487fa2d4cecea508f4fcd70dbd5fd'

class ZJOOC:
    def __init__(self, username="", pwd=""):
        # user = requests.session() session 实例化后可以不用一直填写 Header 和 cookies 太懒了不想改了
        self.session = requests.Session()
        self.session.verify = False
        self._batch_dict = dict()
        
        # 设置基础路径
        self.base_path = get_base_path()
        
        # 尝试从文件加载会话
        session_file = os.path.join(self.base_path, "session.pkl")
        if os.path.exists(session_file):
            try:
                with open(session_file, 'rb') as f:
                    self.session.cookies.update(pickle.load(f))
                
                # 验证会话是否有效
                if self.check_session_valid():
                    print("使用已保存的会话登录成功")
                    # 获取课程信息以更新batch_dict
                    self.coursemsg
                    return
                else:
                    print("保存的会话已过期，需要重新登录")
            except Exception as e:
                print(f"加载会话失败: {e}")
        
        # 如果没有有效的会话，则使用用户名和密码登录
        if username and pwd:
            self.login(username, pwd)
            self.coursemsg
    
    def check_session_valid(self):
        """检查会话是否有效"""
        try:
            # 尝试获取用户信息，如果成功则会话有效
            params = {"service": "/centro/api/user/getProfile", "params[withDetail]": True}
            response = self.session.get(
                "https://www.zjooc.cn/ajax", params=params, headers=Headers
            )
            data = response.json()
            return data.get("resultCode") == 0 and "data" in data
        except Exception:
            return False

    def login(self, username="", pwd="") -> None:
        login_res: dict = {}
        # 修改为只尝试一次登录
        captcha_data = get_captcha()
        captcha_id = captcha_data["id"]  # 验证码ID
        ocr = ddddocr.DdddOcr()
        captcha_code = ocr.classification(base64.b64decode((captcha_data["image"])))
        pprint(f"captcha_code: {captcha_code}")

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
            login_res = self.session.post(
                "https://centro.zjlll.net/login/doLogin", data=login_data
            ).json()
            
            # 检查登录结果
            if login_res.get("resultCode", 1) != 0:
                error_msg = login_res.get("resultMsg", "登录失败，请检查账号密码和验证码")
                print(f"登录失败: {error_msg}")
                raise Exception(error_msg)
                
        except Exception as ex:
            print(f"登录异常: {ex}")
            raise Exception(f"登录失败: {ex}")

        login_param = {
            # 'time': 'm6kxkKnDKxj7kP6yziFQiB8JcAXrsBC41646796129000',
            # time 可以不传 是一个时间戳加密后的数据
            "auth_code": login_res.get("authorization_code", ""),
            "autoLoginTime": "7",
        }
        self.session.get("https://www.zjooc.cn/autoLogin", params=login_param)
        print("登录成功")
        
        # 保存会话到文件
        session_file = os.path.join(self.base_path, "session.pkl")
        try:
            with open(session_file, 'wb') as f:
                pickle.dump(self.session.cookies, f)
            print("会话已保存")
        except Exception as e:
            print(f"保存会话失败: {e}")

    @property
    def infomsg(self) -> dict:
        params = {"service": "/centro/api/user/getProfile", "params[withDetail]": True}
        info_data = self.session.get(
            "https://www.zjooc.cn/ajax", params=params, headers=Headers
        ).json()

        info_data = info_data["data"]
        course_msg_dict = {
            "name": info_data["name"],
            "corpName": info_data["corpName"],
            "studentNo": info_data["studentNo"],
            "loginName": info_data["loginName"],
            "roleType": info_data["roleType"],
        }
        return course_msg_dict

    @property
    def coursemsg(self) -> list:
        return self.get_courses_by_page(1, 5)
        params = {
            "service": "/jxxt/api/course/courseStudent/student/course",
            "params[pageNo]": 1,
            "params[pageSize]": 5,
            "params[coursePublished]=": "",
            "params[courseName]": "",
            "params[batchKey]": "",
        }
        course_msg_data = self.session.get(
            "https://www.zjooc.cn/ajax",
            params=params,
            headers=Headers,
        ).json()["data"]
        course_lst = [
            {
                "id": i,
                "courseId": course_msg_data[i]["id"],
                "courseName": course_msg_data[i]["name"],
                "courseBatchId": course_msg_data[i]["batchId"],
                "courseProcessStatus": course_msg_data[i]["processStatus"],
            }
            for i in range(len(course_msg_data))
        ]

        # 获取课程id对应的batchid
        self._batch_dict = {
            course_msg_data[i]["id"]: course_msg_data[i]["batchId"]
            for i in range(len(course_msg_data))
        }

        return course_lst

    def _get_msg(self, modes: str | int) -> list:
        """
        :param mode: 0-测验 1-考试 2-作业
        :return:  [{}]
        """
        # assert modes in (0, 1, 2)
        modes = str(modes)
        msg_lst: list = []
        for mode in modes:
            params = {
                "params[pageNo]": 1,
                "params[pageSize]": 20,
                "params[paperType]": mode,
                "params[batchKey]": 20231,
            }

            res_msg_data = self.session.get(
                "https://www.zjooc.cn/ajax?service=/tkksxt/api/admin/paper/student/page",
                params=params,
                headers=Headers,
            ).json()["data"]

            msg_lst.extend(
                [
                    {
                        "id": idx,
                        "courseName": data["courseName"],
                        "paperName": data["paperName"],
                        "classId": data["classId"],
                        "courseId": data["courseId"],
                        "paperId": data["paperId"],
                        "scorePropor": data["scorePropor"],
                    }
                    for idx, data in enumerate(res_msg_data)
                ]
            )

        if not msg_lst:
            print("🤣🤣🤣  Congrats!! all work you have done!!!")
        return msg_lst

    @property
    def quizemsg(self) -> list:
        return self._get_msg("0")

    @property
    def exammsg(self) -> list:
        return self._get_msg("1")

    @property
    def hwmsg(self) -> list:
        return self._get_msg("2")

    @property
    def scoremsg(self) -> list:
        score_lst = []
        params = {
            "service": "/report/api/course/courseStudentScore/scoreList",
            "params": {
                "pageNo": 1,
                "pageSize": 20,
                "courseId": "",
                "batchKey": "",
            },
            "checkTimeout": "true",
        }

        res_score_data = self.session.get(
            "https://www.zjooc.cn/ajax?",
            params=params,
            headers=Headers,
        ).json()["data"]
        score_lst = [
            {
                "courseId": data["courseId"],
                "courseName": data["courseName"],
                "finalScore": data["finalScore"],
                "videoScore": data["videoScore"],
                "onlineScore": data["onlineScore"],
                "offlineScore": data["offlineScore"],
                "testScore": data["testScore"],
                "homeworkScore": data["homeworkScore"],
            }
            for data in res_score_data
        ]

        return score_lst

    def get_video_msg(self, course_id, show_all=False) -> list:
        video_msg: list
        params = {
            "params[pageNo]": 1,
            "params[courseId]": course_id,
            "params[urlNeed]": "0",
        }
        video_data = self.session.get(
            "https://www.zjooc.cn/ajax?service=/jxxt/api/course/courseStudent/getStudentCourseChapters",
            params=params,
            headers=Headers,
        ).json()["data"]
        
        video_msg = []
        for chapter in video_data:
            for section in chapter["children"]:
                for resource in section["children"]:
                    # 如果show_all为True，则显示所有视频；否则只显示未完成的视频
                    if show_all or resource["learnStatus"] == 0:
                        video_msg.append({
                            "Name": f'{chapter["name"]}-{section["name"]}-{resource["name"]}',
                            "courseId": course_id,
                            "chapterId": resource["id"],
                            "time": resource.get("vedioTimeLength", 0),
                            "learnStatus": resource["learnStatus"]
                        })

        return video_msg

    def do_video(self, course_id, show_all=False):
        """
        This function performs a video operation for a given course ID.

        Parameters:
            course_id (int): The ID of the course for which the video operation is performed.
            show_all (bool): Whether to process all videos or only unfinished ones.

        Returns:
            None
        """
        # 手动填入要做的video 的 courseid
        if not course_id:
            return

        video_lst = self.get_video_msg(course_id=course_id, show_all=show_all)
        video_cnt = len(video_lst)

        for idx, video in enumerate(video_lst, start=1):
            # 如果视频已完成且不是show_all模式，则跳过
            if not show_all and video.get("learnStatus", 0) == 1:
                continue
                
            if video["time"]:
                params = {
                    "params[chapterId]": video["chapterId"],
                    "params[courseId]": video["courseId"],
                    "params[playTime]": str(video["time"]),
                    "params[percent]": "100",
                }

                self.session.get(
                    "https://www.zjooc.cn/ajax?service=/learningmonitor/api/learning/monitor/videoPlaying",
                    params=params,
                    headers=Headers,
                ).json()
            else:
                params = {
                    "params[courseId]=": video["courseId"],
                    "params[chapterId]=": video["chapterId"],
                }
                self.session.get(
                    "https://www.zjooc.cn/ajax?service=/learningmonitor/api/learning/monitor/finishTextChapter",
                    params=params,
                    headers=Headers,
                ).json()
            progress = idx / video_cnt
            print(
                "\r",
                video["Name"] + "is doing！" + "\r",
                "😎" * int(progress * 10) + ".." * (10 - int(progress * 10)),
                f"[{progress:.0%}]",
                end="",
            )
        print("all done!")

    def get_an(self, paperId, course_id) -> dict:
        """
        Retrieves the answer data for a given paper ID and course ID.

        Args:
            paperId (int): The ID of the paper.
            course_id (int): The ID of the course.

        Returns:
            dict: A dictionary containing the answer data, where the keys are the IDs of the answer data
                and the values are the corresponding right answers.
        """
        if not all([paperId, course_id]):
            return {}

        res_answer_data: list = []
        try:
            answer_data = {
                "service": "/tkksxt/api/student/score/scoreDetail",
                "body": "true",
                # FIXME 默认为 20231
                "params[batchKey]": self._batch_dict.get(course_id, 20231),
                "params[paperId]": paperId,
                "params[courseId]": course_id,
            }

            res_answer_data = self.session.post(
                "https://www.zjooc.cn/ajax",
                data=answer_data,
                headers=Headers,
            ).json()["data"]["paperSubjectList"]
        except Exception as ex:
            print("err:", ex)

        if not check_right_answer(res_answer_data):
            try:
                # 构建 GET 请求的 URL 和查询参数
                url = "https://app.zaizhexue.top/originalJson"
                params = {
                    'id': paperId,
                    'need_data': True,
                    'token': token
                }
                
                # 发送 GET 请求
                response = requests.get(url, params=params)
                
                # 检查请求是否成功
                if response.status_code == 200:
                    res_answer_data = response.json()["data"]["paperSubjectList"]  # 获取返回的 JSON 数据
                    print("Answer Data:", answer_data)
                else:
                    print(f"Request failed with status code {response.status_code}")
                
            except Exception as e:
                print(f"An error occurred: {e}")

        # pprint(
        #     {

        #         html2text.html2text(an_data["subjectName"]): html2text.html2text(
        #             an_data["subjectOptions"][ord(an_data["rightAnswer"]) - 65][
        #                 "optionContent"
        #             ]
        #         )
        #         for an_data in res_answer_data
        #     }
        # )
        return {an_data["id"]: an_data["rightAnswer"] for an_data in res_answer_data}

    def do_an(self, paper_id, course_id, class_id):
        if not all([paper_id, course_id, class_id]):
            return

        # 获取题目答案
        paper_an_data = self.get_an(paper_id, course_id)
        # 申请答题
        answesparams = {
            "service": "/tkksxt/api/admin/paper/getPaperInfo",
            "params[paperId]": paper_id,
            "params[courseId]": course_id,
            "params[classId]": class_id,
            "params[batchKey]": self._batch_dict[course_id],
        }
        paper_data = self.session.get(
            "https://www.zjooc.cn/ajax",
            params=answesparams,
            headers=Headers,
        ).json()["data"]
    
        send_data = {
            "service": "/tkksxt/api/student/score/sendSubmitAnswer",
            "body": "true",
            "params[batchKey]": self._batch_dict[course_id],
            "params[id]": paper_data["id"],
            "params[stuId]": paper_data["stuId"],
            "params[clazzId]": paper_data["paperSubjectList"],
            "params[scoreId]": paper_data["scoreId"],
            **{
                f"params[paperSubjectList][{idx}][id]": subject["id"]
                for idx, subject in enumerate(paper_data["paperSubjectList"])
                for k, v in {
                    "id": subject["id"],
                    "subjectType": subject["subjectType"],
                    "answer": paper_an_data[subject["id"]],
                }.items()
            },
        }
        try:
            res = self.session.post(
                "https://www.zjooc.cn/ajax", data=send_data, headers=Headers
            ).content.decode("utf-8")
            res.raise_for_status
        except requests.RequestException:
            print("Failed to send data!!")

    
    
    def do_ans(self):
        """
        # FIX 谨慎使用！！！
        """
    
        messages_lst = [self.exammsg, self.hwmsg, self.quizemsg]
        paper_cnt = sum(len(msg) for msg in messages_lst)
        for idx, msg in enumerate(chain(*messages_lst)):
            if msg["scorePropor"] != "100/100.0":
                self.do_an(
                    paper_id=msg["paperId"],
                    course_id=msg["courseId"],
                    class_id=msg["classId"],
                )
                progress = idx / paper_cnt
                progress_bar = f"{'😎' * int(progress * 10)}{'--' * (10 - int(progress * 10))}[{progress:.0%}]"
                print("\r", progress_bar, end="")
    def paser(self, commands: str):
        command_list = commands.split()
        print(command_list)

        def error_msg():
            print("paser err!!!")
            print("please enter your commands again!")

        # try:
        match command_list[0]:
            case "msg":
                """
                0-测验 1-考试 2-作业
                3-info 4-course 5-score
                6-video 7-an
                ex:
                    msg 0
                    msg 6 course_id
                    msg 7 paperId course_id
                """
                match command_list[1]:
                    case "0" | "1" | "2":
                        pprint(self._get_msg(command_list[1]))
                    case "3":
                        pprint(self.infomsg)
                    case "4":
                        pprint(self.coursemsg)
                    case "5":
                        pprint(self.scoremsg)
                    case "6":
                        if len(command_list) < 3:
                            error_msg()
                        else:
                            pprint(self.get_video_msg(command_list[2]))
                    case "7":
                        self.get_an(command_list[2], command_list[3])
            case "do":
                """
                0-测验、考试、作业 1-video 2-all[not suggest!!!]
                ex：
                    do 0 paper_id course_id class_id
                    do 1 course_id
                    do 2 #FIX 谨慎使用！！！
                """
                match command_list[1]:
                    case "0":
                        self.do_an(
                            paper_id=command_list[2],
                            course_id=command_list[3],
                            class_id=command_list[4],
                        )
                        print('成功')
                    case "1":
                        self.do_video(command_list[2])
                    case "2":
                        self.do_ans()

            case _:
                error_msg()
                return
        # except Exception as ex:
        #     error_msg()
        #     print(ex)
        #     return

    def get_courses_by_page(self, page_no=1, page_size=20):
        """按页获取课程信息"""
        params = {
            "service": "/jxxt/api/course/courseStudent/student/course",
            "params[pageNo]": page_no,
            "params[pageSize]": page_size,
            "params[coursePublished]=": "",
            "params[courseName]": "",
            "params[batchKey]": "",
        }
        try:
            response = self.session.get(
                "https://www.zjooc.cn/ajax",
                params=params,
                headers=Headers,
            )
            data = response.json()
            
            if data.get("resultCode") != 0 or "data" not in data:
                print(f"获取第{page_no}页课程信息失败")
                return []
            
            course_data = data["data"]
            if not course_data:
                return []
            
            course_lst = [
                {
                    "id": i,
                    "courseId": course_data[i]["id"],
                    "courseName": course_data[i]["name"],
                    "courseBatchId": course_data[i]["batchId"],
                    "courseProcessStatus": course_data[i]["processStatus"],
                }
                for i in range(len(course_data))
            ]
            
            # 更新批次字典
            for i in range(len(course_data)):
                self._batch_dict[course_data[i]["id"]] = course_data[i]["batchId"]
            
            return course_lst
        except Exception as e:
            print(f"获取第{page_no}页课程信息出错: {e}")
            return []
