from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from langchain.vectorstores import Chroma
from langchain.embeddings import OpenAIEmbeddings, HuggingFaceEmbeddings
from threading import Thread
import typer
import uvicorn
from agent import SendingAssistantAgent, SendingUserProxyAgent
from autogen import config_list_from_json, GroupChat, GroupChatManager
import re
import os
from contextlib import asynccontextmanager
import request_schemas
import documentation_loader
import embedded_repo
import chromadb
import uuid
import tools
from typing import Dict, Any
from multiprocessing import Process

import dotenv
dotenv.load_dotenv(".env")

agents = {}
autogen_thread = None
langchain_chroma_code = None
langchain_chroma_docs = None
directory = ""

# embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
embeddings = OpenAIEmbeddings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    a = 2
    yield
    if autogen_thread:
        autogen_thread.stop()

app = FastAPI(lifespan=lifespan)
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/add_source")
def add_source(request: request_schemas.AddDocumentationSourceRequest):
    docs = documentation_loader.load_website_google(request.base_url)
    metadata = []
    ids = []
    texts = []
    for doc in docs:
        doc.metadata["id"] = str(uuid.uuid4())
        metadata.append(doc.metadata)
        texts.append(doc.page_content)
        ids.append(doc.metadata["id"])

    langchain_chroma_docs.add_texts(texts, metadata, ids)
    return {"ok": True}

@app.post("/delete_source")
def delete_source(request: request_schemas.DeleteDocumentationSourceRequest):
    langchain_chroma_docs.delete(ids=[request.id])
    return {"ok": True}

@app.get("/get_sources")
def get_sources():
    global langchain_chroma_docs
    global langchain_chroma_code

    code_sources = langchain_chroma_code.get()
    # print(code_sources)
    code_objects = []
    for i in range(len(code_sources["ids"])):
        code_objects.append({
            "id": code_sources["ids"][i],
            "document": code_sources["documents"][i],
            "metadata": code_sources["metadatas"][i]
        })

    return code_objects

@app.post("/reload_local_sources")
def reload_local_sources():
    # identify which files have already loaded
    all_documents = langchain_chroma_code.get()
    # print(all_documents)
    langchain_chroma_code.delete(ids=all_documents["ids"])

    docs = embedded_repo.get_documents(directory)
    metadata = []
    ids = []
    texts = []
    for doc in docs:
        doc.metadata["id"] = str(uuid.uuid4())
        metadata.append(doc.metadata)
        texts.append(doc.page_content)
        ids.append(doc.metadata["id"])

    langchain_chroma_code.add_texts(texts, metadata, ids)
    # langchain_chroma_code.persist()

    return {"ok": True}

@app.post("/reset_conversation")
def reset_conversation():
    global agents
    global autogen_thread
    for agent in agents.keys():
        agents[agent].reset()

    autogen_thread.terminate()

    return {"ok": True}

@app.post("/initiate_chat")
def initiate_chat(payload: Dict[Any, Any]):
    print("Initiate_chat receieved: ", payload)
    def generate_thread():
        agents["user_proxy"].initiate_chat(
            agents["assistant"],
            message=payload["message"]
        )
    
    autogen_thread = Process(target=generate_thread)
    autogen_thread.start()
    return {"ok": True}

@app.get("/test")
def get_test():
    return {"message": "Server says hello!"}

def setup_autogen():
    global agents

    # planner_config_list = [

    # ]
    # summarizer_config_list = [

    # ]
    # coder_config_list = [
    #     {
    #         'model': 'phind/phind-codellama-34b',
    #         'api_key': os.environ['OPENROUTER_API_KEY'],
    #         "api_type": "open_ai",
    #         'api_base': "https://openrouter.ai/api/v1/"
    #     }
    # ]
    config_list = [
        {
            "model": "gpt-4-1106-preview",
            "api_key": os.environ["OPENAI_API_KEY"]
        }
    ]

    non_interactive_config = {
        "timeout": 240,
        "functions": [],
        "config_list": config_list,
    }

    action_llm_config = {
        "timeout": 240,
        "functions": [],
        "config_list": config_list,
    }

    retrieval_tools = tools.get_retrieval_tools(directory)
    writing_tools = tools.get_writing_tools(directory)

    all_tools = retrieval_tools + writing_tools

    for tool in all_tools:
        action_llm_config["functions"].append(tools.generate_autogen_tool_schema(tool))

    planner_agent = SendingAssistantAgent(
        name="planner",
        system_message="""You are a helpful AI assistant that lives inside a code editor as a programming copilot. You suggest coding, reasoning, and information retrieval steps for another AI assistant to accomplish the task the user is trying to solve. Do not suggest concrete code. 
        For any action beyond writing code or reasoning, convert it to a step that can be implemented by one of the following steps: file search, semantic code search, Google Search context addition, file reading, file writing, shell execution, text replacement in file. 
        Finally, inspect each result line by line. If the plan is not good, suggest a better plan. If the generated code is wrong, analyze the mistake and suggest a fix.""",
        llm_config=non_interactive_config
    )

    planner_user = SendingUserProxyAgent(
        name="planner_user",
        max_consecutive_auto_reply=0,
        human_input_mode="NEVER"
    )

    def ask_planner(message):
        planner_user.initiate_chat(planner_agent, message=message)
        return planner_user.last_message()["content"]
    
    action_llm_config["functions"].append({
        "name": "ask_planner",
        "description": "ask planner to: 1. get a plan for finishing a task, 2. verify results and assess next steps",
        "parameters": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "question to ask planner. Make sure the question includes enough context to make an informed decision."
                }
            }
        }
    })

    assistant_system_message =  """
You are a helpful AI assistant.
Solve tasks using your coding and language skills.
In the following cases, suggest shell script (in a sh coding block) for the user to execute.
    1. When you need to collect info, use the code to output the info you need, for example, download/read a file, find a file, find text within files, print the content of a webpage or a file, get the current date/time, check the operating system. After sufficient info is printed and the task is ready to be solved based on your language skill, you can solve the task by yourself.
    2. When you need to perform some task with code, particularly modifying or creating files, use the code to perform the task and output the result. Finish the task smartly.
Solve the task step by step if you need to. If a plan is not provided, explain your plan first. Be clear which step uses code, and which step uses your language skill.
When using code, you must indicate the script type in the code block. The user cannot provide any other feedback or perform any other action beyond executing the code you suggest. The user can't modify your code. So do not suggest incomplete code which requires users to modify. Don't use a code block if it's not intended to be executed by the user.
If you want the user to save the code in a file before executing it, use a shell script that saves the contents to the file. Don't include multiple code blocks in one response. Do not ask users to copy and paste the result. Instead, use 'print' function for the output when relevant. Check the execution result returned by the user.
If the result indicates there is an error, fix the error and output the code again. Suggest the full code instead of partial code or code changes. If the error can't be fixed or if the task is not solved even after the code is executed successfully, analyze the problem, revisit your assumption, collect additional info you need, and think of a different approach to try.
When you find an answer, verify the answer carefully. Include verifiable evidence in your response if possible.
Reply "TERMINATE" in the end when everything is done.
    """

    assistant = SendingAssistantAgent(
        name="assistant",
        system_message=assistant_system_message,
        llm_config=action_llm_config
    )

    user_proxy_function_map = {}
    for tool in all_tools:
        name = tool.name.lower().replace (' ', '_')
        user_proxy_function_map[name] = tool._run
    user_proxy_function_map["ask_planner"] = ask_planner

    user_proxy = SendingUserProxyAgent(
        name="user_proxy",
        system_message="A human administrator.",
        human_input_mode="ALWAYS",
        function_map=user_proxy_function_map,
        code_execution_config={
            "work_dir": directory,
            "use_docker": False
        }
    )

    agents["user_proxy"] = user_proxy
    agents["assistant"] = assistant
    agents["planner_agent"] = planner_agent
    agents["planner_user"] = planner_user

    for agent in agents:
        agents[agent].set_frontend_url()
        agents[agent].timeout = 240

    # user_proxy.initiate_chat(manager, message="Ask the user what they want to do and solve their problem to the best of your ability.")

def start_server(folder_name: str, server_port: int=54323, frontend_port: int=54322):
    global autogen_thread, langchain_chroma_code, langchain_chroma_docs, directory

    directory = folder_name

    user_home = os.path.expanduser("~")
    superdocs_directory = os.path.join(user_home, ".superdocs")
    dot_replaced = folder_name.replace(".", "dot")

    slugified = re.sub(r'\W+', '', dot_replaced)
    
    chroma_directory = os.path.join(superdocs_directory, slugified[-30:])
    persistent_client = chromadb.PersistentClient(
        chroma_directory
    )

    langchain_chroma_code_collection = persistent_client.get_or_create_collection(
        "code"
    )

    langchain_chroma_docs_collection = persistent_client.get_or_create_collection(
        "docs"
    )

    langchain_chroma_code = Chroma(
        client=persistent_client,
        collection_name="code",
        embedding_function=embeddings
    )

    langchain_chroma_docs = Chroma(
        client=persistent_client,
        collection_name="docs",
        embedding_function=embeddings
    )

    setup_autogen()

    uvicorn.run(app, port=server_port)

if __name__ == "__main__":
    typer.run(start_server)