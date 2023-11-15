import typer
import time
import os
from dotenv import load_dotenv
from tools import generate_autogen_tool_schema, get_tools
import autogen
# from langchain.vectorstores import Chroma

load_dotenv(".env")

def setup(directory, vectorstore=None):
    global llm_config

    config_list = [
        {
            "model": "gpt-4-1106-preview",
            "api_key": os.environ["OPENAI_API_KEY"]
        }
    ]

    llm_config = {
        "functions": [

        ],
        "config_list": config_list,
        "timeout": 120
    }

    function_map = {

    }

    tools = get_tools(directory)
    # if vectorstore:
    #     tools.append(create_vectorstore_search_function(vectorstore))

    for tool in tools:
        llm_config["functions"].append(generate_autogen_tool_schema(tool))
        function_map[tool.name] = tool._run

    return llm_config, function_map

# def create_vectorstore_search_function(local_vectorstore):
#     def search_vectorstore(query: str) -> str:
#         """Runs semantic search on the current codebase. Useful for queries that are too semantically complex for regular matching."""
#         return local_vectorstore.similarity_search_with_score(query, k=10)
#     return search_vectorstore

def create_code_vectorstore_search_function(code_vectorstore):
    pass

def create_documentation_vectorstore_search_function(documentation_vectorstore):
    pass

def run(folder_path: str):
    llm_config, function_map = setup(folder_path)
    user_proxy = autogen.UserProxyAgent(
        name="user_proxy",
        is_termination_msg=lambda x: x.get("content", "") and x.get("content", "").rstrip().endswith("TERMINATE"),
        human_input_mode="ALWAYS",
        max_consecutive_auto_reply=5,
        code_execution_config=False
    )

    # Register the tool and start the conversation
    user_proxy.register_function(
        function_map=function_map
    )

    assistant_agent = autogen.AssistantAgent(
        name="chatbot",
        system_message="For coding tasks, only use the functions you have been provided with.",
        llm_config=llm_config
    )

    user_proxy.initiate_chat(
        assistant_agent,
        message="Ask the user what task they would like to complete. If you are unfamiliar with a term or using an external API, make sure you search for the right documentation."
    )

if __name__ == "__main__":
    typer.run(run)