from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema.messages import HumanMessage, SystemMessage, AIMessage, BaseMessage
import requests


class FrontendStreamCallback(BaseCallbackHandler):
    def __init__(self, base_url="https://localhost:54321"):
        self.messages = []
        self.base_url = base_url

    def reset_messages(self):
        self.messages = []

    def delete_message(self, index):
        self.messages.pop(index)
        self._update_frontend()

    def on_chat_model_start(self, serialized, messages, **kwargs):
        flattened_messages = []
        for message_list in messages:
            for message in message_list:
                flattened_messages.append(self._message_to_json(message))
        
        self.messages = flattened_messages
        self._update_frontend()

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        self.messages[-1]["content"] += token
        self._update_frontend()

    def on_llm_end(self) -> None:
        self._update_frontend(done_loading=True)

    def _message_to_json(self, message):
        if type(message) == HumanMessage:
            return {"role": "human", "content": message.content}
        elif type(message) == SystemMessage:
            return {"role": "system", "content": message.content}
        else:
            return {"role": "ai", "content": message.content}

    def _update_frontend(self, done_loading=False):
        requests.post(self.base_url + "/messages", {
            "messages": self.messages,
            "done": done_loading
        })

    