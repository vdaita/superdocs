from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from langchain.vectorstores import Chroma
from langchain.embeddings import OpenAIEmbeddings, SentenceTransformerEmbeddings
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
api_key = None

embeddings = SentenceTransformerEmbeddings(model_name="all-MiniLM-L6-v2")

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
    agents["user_proxy"].initiate_chat(
        agents["gc_manager"],
        message=payload["message"]
    )
    # def generate_thread():
    #     agents["user_proxy"].initiate_chat(
    #         agents["gc"],
    #         message=payload["message"]
    #     )
    
    # autogen_thread = Process(target=generate_thread)
    # autogen_thread.start()
    return {"ok": True}

@app.get("/test")
def get_test():
    return {"message": "Server says hello!"}

def setup_autogen():
    global agents

    print("API key: ", api_key)

    config_list = [
        {
            "model": "gpt-4-1106-preview",
            "api_key": api_key
        }
    ]

    llm_config = {
        "timeout": 240,
        "request_timeout": 240,
        "functions": [],
        "config_list": config_list,
    }
    
    function_map = {

    }

    PLANNING_SYSTEM_MESSAGE = """
    You are a product manager. Revise the plan based on feedback from admin and critic, until admin approval.
    Do not suggest code directly. That will be handled by the coder agent.
    Find ways to solve the task step by step if you need to. Explain your plan. Be clear which step uses code, and which step uses other processing.
    When you find an answer, verify the answer carefully. Include verifiable evidence in your response if possible.
    
    Reply "TERMINATE" in the end when everything is done.
    """

    CODER_SYSTEM_MESSAGE = """
    You are a senior software developer.
    Solve subtasks provided by the product manager using your coding and language skills.
    If you are using a library that might have been updated recently, search for the most recent documentation.
    In the following cases, suggest shell script (in a sh coding block) for the user to execute.
        1. When you need to collect info, use the code to output the info you need, for example, browse or search the web, download/read a file, print the content of a webpage or a file, get the current date/time, check the operating system. After sufficient info is printed and the task is ready to be solved based on your language skill, you can solve the task by yourself.
        2. When you need to write to the filesystem, download relevant packages, or otherwise make modifications to help implement the task in the user's filesystem.

    Solve the task step by step if you need to. Be clear which step uses code, and which step uses your language skill.
    When using code, you must indicate the script type in the code block. The user cannot provide any other feedback or perform any other action beyond executing the code you suggest. The user can't modify your code. So do not suggest incomplete code which requires users to modify. Don't use a code block if it's not intended to be executed by the user.
    Don't include multiple code blocks in one response. Do not ask users to copy and paste the result. Instead, use 'print' function for the output when relevant. Check the execution result returned by the user.
    
    If the result indicates there is an error, fix the error and output the code again. Suggest the full code instead of partial code or code changes. If the error can't be fixed or if the task is not solved even after the code is executed successfully, analyze the problem, revisit your assumption, collect additional info you need, and think of a different approach to try.

    When you find an answer, verify the answer carefully. Include verifiable evidence in your response if possible.
    Reply "TERMINATE" in the end when everything is done.
    """

    REVIEWER_SYSTEM_MESSAGE = """
    You are a code reviewer. Double check plans and code from other agents that write to the filesystem and provide feedback.
    Reply "TERMINATE" in the end when everything is done.
    """


    agent_tools = tools.get_retrieval_tools(directory=directory, vectorstore=langchain_chroma_code)
    for tool in agent_tools:
        llm_config["functions"].append(tools.generate_autogen_tool_schema(tool))
        name = tool.name.lower().replace(" ", "_")
        function_map[name] = tool._run

    print(llm_config)

    planner_agent = SendingAssistantAgent(
        name="Planner",
        system_message=PLANNING_SYSTEM_MESSAGE,
        llm_config=llm_config,
        function_map=function_map
    )

    coder_agent = SendingAssistantAgent(
        name="Coder",
        system_message=CODER_SYSTEM_MESSAGE,
        llm_config=llm_config,
        function_map=function_map
    )

    reviewer_agent = SendingAssistantAgent(
        name="Reviewer",
        system_message=REVIEWER_SYSTEM_MESSAGE,
        llm_config=llm_config,
        function_map=function_map
    )

    user_proxy = SendingUserProxyAgent(
        name="user_proxy",
        system_message="A human administrator",
        human_input_mode="ALWAYS",
        code_execution_config={
            "work_dir": directory,
            "use_docker": False
        }
    )

    agents = {
        "planner_agent": planner_agent,
        "coder_agent": coder_agent,
        "reviewer_agent": reviewer_agent,
        "user_proxy": user_proxy
    }
    for agent in agents:
        agents[agent].set_frontend_url()

    groupchat = GroupChat(
        agents=[agents[name] for name in agents.keys()],
        messages=[],
        max_round=12,
    )
    manager = GroupChatManager(groupchat=groupchat, llm_config=llm_config)

    agents["gc_manager"] = manager
    agents["gc"] = groupchat

    # user_proxy.initiate_chat(manager, message="Ask the user what they want to do and solve their problem to the best of your ability.")

def start_server(folder_name: str, openai_api_key: str, server_port: int=54323):
    global autogen_thread, langchain_chroma_code, langchain_chroma_docs, directory, api_key

    directory = folder_name
    api_key = openai_api_key

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