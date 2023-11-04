from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema.messages import HumanMessage, SystemMessage, AIMessage, BaseMessage
from langchain.schema.output import LLMResult
import requests
from typing import Union
import json


class FrontendStreamCallback(BaseCallbackHandler):
    def __init__(self, base_url="http://localhost:3005"):
        self.messages = []
        self.base_url = base_url

    def reset_messages(self):
        self.messages = []

    def delete_message(self, index):
        self.messages.pop(index)
        self._update_frontend()

    def on_chat_model_start(self, serialized, messages, **kwargs):
        print("Chat model execution started.")
        flattened_messages = []
        for message_list in messages:
            for message in message_list:
                flattened_messages.append(self._message_to_json(message))
        
        self.messages = flattened_messages
        self.messages.append({
            "role": "assistant",
            "content": ""
        })
        self._update_frontend()

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        print("Received token: ", token)
        self.messages[-1]["content"] += token
        self._update_frontend()

    def on_llm_end(self, response: LLMResult, **kwargs) -> None:
        print("LLM execution ended.")
        self._update_frontend(done_loading=True)

    def on_llm_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs):
        print("LLM error: ", error)

    def on_text(self, text: str, **kwargs):
        print("Received text: ", text)

    def _message_to_json(self, message):
        if type(message) == HumanMessage:
            return {"role": "human", "content": message.content}
        elif type(message) == SystemMessage:
            return {"role": "system", "content": message.content}
        else:
            return {"role": "ai", "content": message.content}

    def _update_frontend(self, done_loading=False):
        print("Sending: ", self.messages, done_loading)
        payload_json = {
            "messages": self.messages,
            "done": done_loading
        }
        headers = {
            "Content-Type": "application/json"
        }

        requests.post(self.base_url + "/messages", json=payload_json, headers=headers)

    