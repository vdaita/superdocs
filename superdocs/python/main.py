from flask import request
from langchain.chat_models import ChatOpenAI
from langchain.vectorstores import Chroma
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.schema import SystemMessage, HumanMessage, AIMessage
from repo import list_non_ignored_files, find_closest_file, get_documents
from langchain.tools import format_tool_to_openai_function
from search_and_replace import find_best_match
from ripgrepy import Ripgrepy
from openai import OpenAI
import json
from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS, cross_origin
import os
import logging
import re

load_dotenv()

# openai_client = OpenAI(
#     api_key=os.environ["OPENROUTER_API_KEY"],
#     base_url="https://openrouter.ai/api/v1"
# )

# model_name = "phind/phind-codellama-34b"

openai_client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"]
)
model_name = "gpt-4-1106-preview"

app = Flask(__name__)
cors = CORS(app, resources={r"/*": {"origins": "*"}})
logging.getLogger('flask_cors').level = logging.DEBUG


embeddings = HuggingFaceEmbeddings(model_name="TaylorAI/bge-micro-v2")
perplexity_model = ChatOpenAI(
    model_name="pplx-70b-online",
    openai_api_key=os.environ["PERPLEXITY_API_KEY"],
    openai_api_base="https://api.perplexity.ai",
    max_tokens=800
)

db = {
    "vectorstore": None,
    "directory": None
}

def get_retrieval_tools(directory):
    def external_search(args):
        query = args["query"]
        # return f"Query: {query} \n \n Response: Test Perplexity Response"
        model_response = perplexity_model([HumanMessage(content=query)]).content
        print("Perplexity model response: ", query, model_response)
        return f"Query: {query} \n \n Response: {model_response}"
    def read_file(args):
        filepath = args["query"]
        closest_filepath = find_closest_file(directory, filepath)
        if not(closest_filepath):
            return "Filepath does not exist"
        file = open(os.path.join(directory, closest_filepath), "r")
        contents = file.read()
        file.close()
        return f"File contents of: {closest_filepath} \n \n ```\n{contents}\n```"
    def semantic_search(args):
        global db
        if db["vectorstore"]:
            query = args["query"]
            docs = db["vectorstore"].similarity_search(query)
            snippet_text = "\n\n".join([f"File: {doc.metadata['source']} \n \n Content: {doc.page_content} \n ------" for doc in docs])
            return f"Semantic search query: {query} \n \n Snippets found: {snippet_text}"
        return "Semantic search has been disabled."
    def lexical_search(args):
        """Accepts regular expression search query and searches for all instances of it."""
        query = args["query"]
        rg = Ripgrepy(query, directory)
        searched_content = rg.H().n().run().as_string
        if len(searched_content) > 1200:
            return "Too many instances"
        return f"File lexical search: {query} \n \n Retrieved content: {searched_content}"
    return {
        "external": external_search,
        "file": read_file,
        "semantic": semantic_search,
        "lexical": lexical_search
    }

def extract_content(text, tag):
 pattern = r'<' + tag + '>(.*?)</' + tag + '>'
 matches = re.findall(pattern, text, re.DOTALL)
 return matches

def remove_code_block(text):
    # Remove "```languagename" at the start
    text = re.sub(r'^```[a-zA-Z0-9]+\n', '', text)
    # Remove '```' at the end
    text = re.sub(r'```$', '', text)
    return text

@app.post("/load_vectorstore")
def load_vectorstore():
    data = request.get_json()
    directory = data["directory"]
    print("Loading the vectorstore....")
    documents = get_documents(directory)
    print("Got the documents...")
    db["vectorstore"] = Chroma.from_documents(documents, embeddings)
    return {"ok": True}

@app.post("/information")
def extract_information():
    data = request.get_json()
    directory = data["directory"]
    messages = data["messages"]
    global db

    print("Received: ", data)

    # Add all relevant information relating to adding context
    existing_context = ""

    user_objective_list = ""

    for message in messages:
        if message["role"] == "user":
            if message["content"].startswith("CONTEXT"):
                existing_context += message["content"]
            else:
                user_objective_list += message["content"] + "\n"
        elif message["role"] == "tool":
            existing_context += message["content"]

    INFORMATION_EXTRACTION_SYSTEM_PROMPT = """
    Your job is to serve as an context extraction system for a coding assistant.
    You have the ability to use functions to extract context, namely: external search, codebase semantic search, codebase lexical search, file reading, and user asking.
    You will be given the following information: Filesystem information, existing context and objective.
    Use the absolute minimum queries required to find the information required to solve the objective. 
    Output DONE if there is no further information that needs to be provided as context.
    
    Generate a list of requests formatted in the following manner:
    If one or more external API, documentation, or information search requests should be made, enclose each external request separately with: <external>Your search query</external> <external>...</external>
    Be specific about the context of your environment when making external information search requests (like stating the programming language).

    If one or more local codebase semantic search queries should be made, enclose each local codebase semantic search query separately with: <semantic>Your semantic search query</semantic>
    If one or more codebase lexical search queries should be made, enclose each local codebase lexical search query separately with: <lexical>Your query</lexical> 
    If one or more file read queries should be made, enclose each file read queries separately with: <file>The filepath you are requesting</file>

    Let's think step by step.
    """

    CONTEXT_MESSAGE = f"""
    Filesystem information:
    {list_non_ignored_files(directory)}
    \n \n
    Existing context:
    {existing_context}
    \n \n
    Objective: {user_objective_list}
    """

    messages = [
        {
            "role": "system",
            "content": INFORMATION_EXTRACTION_SYSTEM_PROMPT
        },
        {
            "role": "user",
            "content": CONTEXT_MESSAGE
        }
    ]

    tool_functions = get_retrieval_tools(directory)

    response = openai_client.chat.completions.create(
        model=model_name,
        messages=messages,
        max_tokens=512,
        temperature=0.1
    )

    response_message = response.choices[0].message.content

    print("Response message: ", response_message)

    return_messages = []

    for function_name in tool_functions.keys():
        extractions = extract_content(response_message, function_name)
        for extraction in extractions:
            args = {"query": extraction.strip()}
            return_messages.append({
                "role": "assistant",
                "content": tool_functions[function_name](args)
            })

    return_messages.append({
        "role": "assistant",
        "content": f"Info retrieval bot says: \n {response_message}"
    })
    
    return return_messages

@app.post("/plan")
def break_down_problem(): 
    # TODO: Have the user's objective be stated with OBJECTIVE to make it more clear to the model.
    data = request.get_json()
    directory = data["directory"]
    user_messages = data["messages"]

    print("Received: ", data)

    PLANNING_SYSTEM_PROMPT = """
    Given the following context and the user's objective, create a plan for modifying the codebase and running commands to solve the objective.
    Create a step-by-step plan to accomplish these objectives without writing any code. Enclose the plan list in <plan> and end it with </plan>
    The plan executor can only: replace content in files and provide code instructions to the user. 
    Under each command, write subinstructions that break down the solution so that the code executor can write the code.
    PLEASE DO NOT WRITE ANY CODE YOURSELF.
    
    Let's think step by step.
    """ # Format the steps within function calls - relevant parts already be fully contextualized 

    plan_changes_messages = [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
    ]
    plan_changes_messages.extend(user_messages)

    response = openai_client.chat.completions.create(
        model=model_name,
        messages=plan_changes_messages,
    )
    response_message = response.choices[0].message.content

    print("Response message: ", response_message)

    return [{"role": "assistant", "content": f"Planner: \n {response_message}"}]
    
@app.post("/execute")
def solve_problem():
    data = request.get_json()
    directory = data["directory"]
    messages = data["messages"]
    
    print("Received: ", data)

    # what should be the execution?
    EXECUTOR_SYSTEM_PROMPT = """
    Your job is to implement according to the instructions provided, messages exchanged between the assistant (planner and information retriever) and the user and the steps and instructors provided.
    Use the tools to the best of your ability. Ask a question if required.
    
    State additional information outside of replacement tags.
    Format each replacement separately using these tags:
    <replacement>
        <filepath>
            This should contain the filepath of the file you want to replace.
        </filepath>
        <original>
            This should contain the original snippet that you are seeking to replace, directly from the file.
        </original>
        <updated>
            This should contain the updated code that you wrote.
        </updated>
    </replacement>

    Let's think step by step.
    """

    solve_messages = [
        {"role": "system", "content": EXECUTOR_SYSTEM_PROMPT}
    ]
    solve_messages.extend(messages)

    response = openai_client.chat.completions.create(
        model=model_name,
        messages=solve_messages,
        max_tokens=1024,
        temperature=0.1
    )
    print("Received response: ", response)
    response_message = response.choices[0].message.content
    # Extract the replacement content and then convert to Javascript. Have it be a message from the tool

    return_messages = [
        
    ]

    non_response_text = response_message    
    replacements = extract_content(response_message, "replacement")
    for replacement in replacements:
        filepath = extract_content(replacement, "filepath")[0]
        closest_filepath = find_closest_file(directory, filepath)
        file = open(os.path.join(directory, closest_filepath), "r+")
    

        original_code = extract_content(replacement, "original")[0]
        updated_code = extract_content(replacement, "updated")[0]
        
        original_code = remove_code_block(original_code)
        updated_code = remove_code_block(updated_code)

        contents = file.read()
        grounded_original_text = find_best_match(original_code, contents)
        
        non_response_text = non_response_text.replace(replacement, "") # Remove the replacement text from the messages
        
        message_str = "REPLACEMENT\n" + json.dumps({
            "filepath": closest_filepath,
            "original_text": grounded_original_text,
            "new_text": updated_code
        })
        return_messages.append({
            "role": "assistant",
            "content": message_str
        })

    non_response_text = non_response_text.replace("<replacement>", "")
    non_response_text = non_response_text.replace("</replacement>", "")

    return_messages.append({
        "role": "assistant",
        "content": f"Executor: \n {non_response_text}"
    })

    print("Returning messages: ", return_messages)
    
    return return_messages
