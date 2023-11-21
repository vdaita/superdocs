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

import dotenv
dotenv.load_dotenv(".env")

agents = {}
autogen_thread = None
langchain_chroma_code = None
langchain_chroma_docs = None
directory = ""

embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

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

    docs_sources = langchain_chroma_docs.get()
    code_sources = langchain_chroma_code.get()

    docs_sources.extend(code_sources)
    return docs_sources

@app.post("/reload_local_sources")
def reload_local_sources():
    # identify which files have already loaded
    all_documents = langchain_chroma_code.get()
    ids = [document.metadata["id"] for document in all_documents]
    langchain_chroma_code.delete(ids=ids)

    docs = embedded_repo.get_documents(directory)
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

@app.post("/reset_conversation")
def reset_conversation():
    autogen_thread._stop()
    agents["groupchat"].reset()
    return {"ok": True}

@app.post("/initiate_chat")
def initiate_chat(payload: Dict[Any, Any]):
    print("Initiate_chat receieved: ", payload)
    def generate_thread():
        agents["user_proxy"].initiate_chat(
            agents["manager"],
            message=payload["message"]
        )
    
    autogen_thread = Thread(target=generate_thread)
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
            "model": "gpt-3.5-turbo-1106",
            "api_key": os.environ["OPENAI_API_KEY"]
        }
    ]

    retrieval_llm_config = {
        "functions": [],
        "config_list": config_list,
        "timeout": 120
    }

    retrieval_tools = tools.get_retrieval_tools(directory)
    for tool in retrieval_tools:
        retrieval_llm_config["functions"].append(tools.generate_autogen_tool_schema(tool))

    writing_llm_config = {
        "functions": [],
        "config_list": config_list,
        "timeout": 120 
    }

    writing_tools = tools.get_writing_tools(directory)
    for tool in writing_tools:
        writing_llm_config["functions"].append(tools.generate_autogen_tool_schema(tool))

    planner_agent = SendingAssistantAgent(
        name="planner",
        system_message="You are a planning agent. Be as concise as possible. If the task provided to you is a complex query, your job is to take the current task and break it down into smaller parts. Reply `TERMINATE` in the end when everything is done.",
        llm_config=retrieval_llm_config
    )

    coder_agent = SendingAssistantAgent(
        name="senior_engineer",
        system_message="You are a senior developer. If you lack context or information, say so. Be as concise as possible. Reply `TERMINATE` in the end when everything is done.",
        llm_config=retrieval_llm_config
    )

    critic_agent = SendingAssistantAgent(
        name="critic_agent",
        system_message="Your job is to check the code written for accuracy. If there are issues, describe the problems. Be as concise as possible. Reply `TERMINATE` in the end when everything is done.",
        llm_config=retrieval_llm_config
    )

    user_proxy = SendingUserProxyAgent(
        name="user_proxy",
        system_message="A human administrator.",
        human_input_mode="ALWAYS",
        llm_config=writing_llm_config
    )

    agent_list = [planner_agent, information_agent, coder_agent, critic_agent, user_proxy]
    for agent in agent_list:
        agent.set_frontend_url()
        agents[agent.name] = agent

    retrieval_agents = [planner_agent, information_agent, coder_agent, critic_agent]
    retrieval_function_map = {}
    for tool in retrieval_tools:
        retrieval_function_map[tool.name] = tool._run
    for agent in retrieval_agents:
        agent.register_function(
            function_map=retrieval_function_map
        )
    
    writing_function_map = {}
    for tool in writing_tools:
        writing_function_map[tool.name] = tool._run
    user_proxy.register_function(
        function_map=writing_function_map
    )

    groupchat = GroupChat(agents=[user_proxy, planner_agent, information_agent, coder_agent, critic_agent], messages=[], max_round=12)
    manager = GroupChatManager(groupchat=groupchat, llm_config={"config_list": config_list})
    agents["manager"] = manager
    agents["groupchat"] = groupchat

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