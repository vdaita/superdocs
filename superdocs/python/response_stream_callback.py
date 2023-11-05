from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema.messages import HumanMessage, SystemMessage, AIMessage, BaseMessage
from langchain.schema.output import LLMResult
from langchain.schema.agent import AgentAction
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
        # self.messages.append({
        #     "role": "ai",
        #     "content": ""
        # })
        self._update_frontend()

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        # print("Received token: ", token)
        if not(self.messages[-1]["role"] == "ai"):
            self.messages.append({
                "role": "ai",
                "content": ""
            })
        self.messages[-1]["content"] += token
        self._update_frontend()

    def on_llm_end(self, response: LLMResult, **kwargs) -> None:
        print("LLM execution ended.")
        self._update_frontend(done_loading=True)

    def on_llm_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs):
        print("LLM error: ", error)

    def on_text(self, text: str, **kwargs):
        print("Received text: ", text)

    def on_tool_start(self, serialized, input_str, **kwargs):
        print(serialized, input_str)
        tool_start_object = {"serialized": serialized, "input_str": input_str}
        new_message = "```json\n" + str(tool_start_object) + "\n```"
        self.messages.append({
            "role": "system",
            "content": new_message
        })
        self._update_frontend()
    
    def on_tool_end(self, output, **kwargs):
        print("Received tool output: ", output)
        new_message = "**Tool output** \n " + output
        self.messages.append({
            "role": "system",
            "content": new_message
        })
        self._update_frontend()
    
    def on_agent_action(self, action: AgentAction, **kwargs):
        print("Received agent action: ", action)
        agent_action_object = {
            "tool": action.tool,
            "tool_input": action.tool_input
        }

        new_message = "**Agent action** \n ```json\n" + str(agent_action_object) + "\n```"
        
        print("Sending from agent_action: ", new_message)
        
        self.messages.append({
            "role": "ai",
            "content": new_message
        })
        self._update_frontend()

    def _message_to_json(self, message):
        if type(message) == HumanMessage:
            return {"role": "human", "content": message.content}
        elif type(message) == SystemMessage:
            return {"role": "system", "content": message.content}
        else:
            return {"role": "ai", "content": message.content}

    def _filter_replace_text(self, input_text):
        split_str = "This was your previous work (but I haven't seen any of it! I only see what you return as final answer):"
        # print(input_text.split(split_str))
        action_split = "Action:"
        obs_split = "Observation:"

        split_input = input_text.split(split_str)

        action_part = ""

        if len(split_input) > 1:
            after_prev = split_input[1].split(action_split)
            if len(after_prev) > 1:
                action_part = after_prev[1].split(obs_split)[0]
        
        # print("First part: ", split_input)

        if '"action": "Final Answer"' in action_part:
            action_part = ""

        return split_input[0] + "\n" + action_part


    def _update_frontend(self, done_loading=False):
        # print("Sending: ", self.messages, done_loading)

        # Filtering observations cause showing that output properly is a menace
        filtered_messages = []
        for message in self.messages:
            if message["role"] == "system":
                # print("System message start: ", message["content"][:100])
                if not("**Agent action**" in message["content"]):
                    continue
            filtered_messages.append({
                "role": message["role"],
                "content": self._filter_replace_text(message["content"])
            })

        payload_json = {
            "messages": filtered_messages,
            "done": done_loading
        }
        headers = {
            "Content-Type": "application/json"
        }

        requests.post(self.base_url + "/messages", json=payload_json, headers=headers)

    