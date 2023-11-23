from autogen import Agent, AssistantAgent, UserProxyAgent, config_list_from_json
from typing import Dict, Optional, Union
import requests
import request_schemas
import json

# based on: https://github.com/Chainlit/cookbook/blob/main/pyautogen/app.py

class SendingAssistantAgent(AssistantAgent):
    def set_frontend_url(self, frontend_url="http://localhost:54322"):
          self.frontend_url = frontend_url

    def send(
            self,
            message: Union[Dict, str],
            recipient: Agent,
            request_reply: Optional[bool] = None,
            silent: Optional[bool] = False
    ):
            
            headers = {
                "Content-Type": "application/json"
            }

            requests.post(self.frontend_url + "/messages", json={
                  "from": self.name,
                  "to": recipient.name,
                  "content": message
            }, headers=headers)

            super(SendingAssistantAgent, self).send(
                  message=message,
                  recipient=recipient,
                  request_reply=request_reply,
                  silent=silent
            )

class SendingUserProxyAgent(UserProxyAgent):
        def get_human_input(self, prompt: str) -> str:
            print("Requesting human input: ", prompt)
            if prompt.startswith(
                    "Provide feedback to"
            ):
                res = requests.get(self.frontend_url + "/get_user_response")
                print("Got user response: ", res.content)

                content = res.content
                json_text = content.decode("utf-8")
                json_response = json.loads(json_text)
                
                message = json_response["message"]
                
                if message == "Continue":
                    return ""
                elif message == "Exit":
                    return "exit"
                
                return message.strip()
            
        def set_frontend_url(self, frontend_url="http://localhost:54322"):
            self.frontend_url = frontend_url
            
        def send(
            self,
            message: Union[Dict, str],
            recipient: Agent,
            request_reply: Optional[bool] = None,
            silent: Optional[bool] = False
        ):
            headers = {
                "Content-Type": "application/json"
            }

            requests.post(self.frontend_url + "/messages", json={
                  "from": self.name,
                  "to": recipient.name,
                  "content": message
            }, headers=headers)

            super(SendingUserProxyAgent, self).send(
                    message=message,
                    recipient=recipient,
                    request_reply=request_reply,
                    silent=silent
            )
