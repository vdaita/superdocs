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

load_dotenv()

openai_client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"]
) # Langchain seems to have a mid functions implementation 

app = Flask(__name__)
cors = CORS(app, resources={r"/*": {"origins": "*"}})
logging.getLogger('flask_cors').level = logging.DEBUG


embeddings = HuggingFaceEmbeddings(model_name="TaylorAI/bge-micro-v2")
perplexity_model = ChatOpenAI(
    model_name="pplx-api/",
    openai_api_key=os.environ["PERPLEXITY_API_KEY"],
    openai_api_base="https://api.perplexity.ai",
    headers={"HTTP-Referer": "http://localhost:3000"},
    max_tokens=800
)

db = {
    "vectorstore": None,
    "directory": None
}

def get_retrieval_tools(directory):
    def external_search(args):
        query = args["query"]
        return f"Query: {query} \n \n Response: Test Perplexity Response"
        # return f"Query: {query} \n \n Response: {perplexity_model([HumanMessage(query)]).content}"
    def read_file(args):
        filepath = args["filepath"]
        closest_filepath = find_closest_file(directory, filepath)
        if not(closest_filepath):
            return "Filepath does not exist"
        file = open(os.path.join(directory, closest_filepath), "r")
        contents = file.read()
        file.close()
        return f"File contents of: {closest_filepath} \n \n ```\n{contents}\n```"
    def semantic_search(args):
        global db
        query = args["query"]
        docs = db["vectorstore"].similarity_search(query)
        snippet_text = "\n\n".join([f"File: {doc.metadata['source']} \n \n Content: {doc.page_content} \n ------" for doc in docs])
        return f"Semantic search query: {query} \n \n Snippets found: {snippet_text}"
    def lexical_search(args):
        """Accepts regular expression search query and searches for all instances of it."""
        query = args["query"]
        rg = Ripgrepy(query, directory)
        searched_content = rg.H().n().run().as_string
        if len(searched_content) > 1200:
            return "Too many instances"
        return f"File lexical search: {query} \n \n Retrieved content: {searched_content}"
    return {
        "external_search": external_search,
        "read_file": read_file,
        "semantic_search": semantic_search,
        "lexical_search": lexical_search
    }

retrieval_tools_openai = [
    {
        "type": "function",
        "function": {
            "name": "external_search",
            "description": "Question-formatted query. Query external search for specific subinformation (break the question down into pieces of info to retrieve). Useful for understanding errors or getting up to date information about libraries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Specific information to be queried"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file on the filesystem",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {
                        "type": "string",
                        "description": "Specific filepath to retrieve"
                    }
                }
            }
        }
    },
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "semantic_search",
    #         "description": "Semantically search for information on the file system. Useful for when you don't know the exact name of a tool.",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "query": {
    #                     "type": "string",
    #                     "description": "Query for semantic search"
    #                 }
    #             }
    #         }
    #     }
    # },
    {
        "type": "function",
        "function": {
            "name": "lexical_search",
            "description": "Lexically search for information on the filesystem. Useful for when you do know the name of a tool.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Regular expression search term"
                    }
                }
            }
        }
    }
]

def get_executor_tools(directory):
    def replace_in_file(args):
        filepath = args["filepath"]
        first_few_lines = args["first_few_lines_to_replace"]
        last_few_lines = args["last_few_lines_to_replace"]
        original_text = args["original_text"]
        new_text = args["new_text"]

        closest_filepath = find_closest_file(directory, filepath)
        if not(closest_filepath):
            return '{"error": True}'

        file = open(os.path.join(directory, closest_filepath), "r+")

        contents = file.read()
        lines = file.split("\n")
        best_match = find_best_match(original_text, contents)
        
        code_original_text = "\n".join(lines[best_match.start:best_match.end + 1])

        return json.dumps({
            "filepath": closest_filepath,
            "first_few_lines": first_few_lines,
            "last_few_lines": last_few_lines,
            "original_text": code_original_text,
            "new_text": new_text
        })
    def write_file(args):

        filepath = args["filepath"]
        new_text = args["text"]

        return json.dumps({
            "filepath": filepath,
            "text": new_text
        })
        # file = open(os.path.join(directory, filepath), "w+")
        # file.write(new_text)
        # file.close()
        # return "Successfully wrote to file" # TODO: replace with JSON formatting
    def add_feedback(args):
        return args["content"]
    return  {"replace_in_file": replace_in_file, "write_file": write_file, "add_feedback": add_feedback}

executor_tools_openai = [
    {
        "type": "function",
        "function": {
            "name": "replace_in_file",
            "description": "Replace content in the desired filepath. Use this to replace snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {
                        "type": "string",
                        "description": "Filepath to the file you are doing the replacement on."
                    },
                    "first_few_lines_to_replace": {
                        "type": "string",
                        "description": "The first few lines of the text you want to replace."
                    },
                    "last_few_lines_to_replace": {
                        "type": "string",
                        "description": "Last few lines of the text you want to replace."
                    },
                    "original_text": {
                        "type": "string",
                        "description": "Text within the original file that should be removed and replaced."
                    },
                    "new_text": {
                        "type": "string",
                        "description": "Text that should be inserted and used as replacement for original_text."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create and write file to the desired filepath.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {
                        "type": "string",
                        "description": "Filepath to the file you are writing to."
                    },
                    "text": {
                        "type": "string",
                        "description": "Content to write."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_feedback",
            "description": "Provide additional instructions and information to the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "Text"
                    }
                }
            }
        }
    }
]

@app.post("/information")
def extract_information():
    data = request.get_json()
    directory = data["directory"]
    messages = data["messages"]
    global db

    # if db["directory"] != directory:
    #     documents = get_documents(directory)
    #     db["vectorstore"] = Chroma.from_documents(documents, embeddings)
    #     pass

    # Add all relevant information relating to adding context
    existing_context = ""

    for message in messages:
        if message["role"] == "user":
            if message["content"].startswith("CONTEXT"):
                existing_context += message["content"]
        elif message["role"] == "tool":
            existing_context += message["content"]
    
    INFORMATION_EXTRACTION_SYSTEM_PROMPT = """
    Your job is to serve as an context extraction system for a coding assistant.
    You have the ability to use functions to extract context, namely: external search, codebase semantic search, codebase lexical search, file reading, and user asking.
    You will be given the following information: Filesystem information, existing context and objective.
    Use the absolute minimum queries required to find the information required to solve the objective. 
    
    Output DONE if there is no further information that needs to be provided as context.
    """

    CONTEXT_MESSAGE = f"""
    Filesystem information:
    {list_non_ignored_files(directory)}
    \n \n
    Existing context:
    {existing_context}
    \n \n
    Objective: {messages[-1]["content"]}
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
        model="gpt-4-1106-preview",
        messages=messages,
        tools=retrieval_tools_openai,
        tool_choice="auto",
        max_tokens=512
    )
    response_message = response.choices[0].message
    tool_calls = response_message.tool_calls

    return_messages = [
        json.loads(response_message.model_dump())
    ]

    if tool_calls:
        for tool_call in tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            function_response = tool_functions[function_name](function_args)
            return_messages.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "name": function_name,
                "content": function_response
            })
    else:
        return_messages.append({
            "role": "assistant",
            "content": f"Info retrieval bot says: \n {response_message.content}"
        })
    
    return return_messages

@app.post("/plan")
def break_down_problem(): 
    # TODO: Have the user's objective be stated with OBJECTIVE to make it more clear to the model.
    data = request.get_json()
    directory = data["directory"]
    user_messages = data["messages"]

    PLANNING_SYSTEM_PROMPT = """
    Given the following context and the user's objective, create a plan for modifying the codebase and running commands to solve the objective.
    Create a step-by-step plan to accomplish these objectives without writing any code. Enclose the plan list in <plan> and end it with </plan>
    The plan executor can only: replace content in files and provide code instructions to the user. 
    Under each command, write subinstructions that break down the solution so that the code executor can write the code.
    PLEASE DO NOT WRITE ANY CODE YOURSELF.
    """ # Format the steps within function calls - relevant parts already be fully contextualized 

    plan_changes_messages = [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
    ]
    plan_changes_messages.extend(user_messages)

    response = openai_client.chat.completions.create(
        model="gpt-4-1106-preview",
        messages=plan_changes_messages,
    )
    response_message = response.choices[0].message

    return {"role": "assistant", "content": f"Planner: \n {response_message.content}"}
    
@app.post("/execute")
def solve_problem():
    data = request.get_json()
    directory = data["directory"]
    messages = data["messages"]

    # what should be the execution?
    EXECUTOR_SYSTEM_PROMPT = """
    Your job is to implement according to the instructions provided, messages exchanged between the assistant and the user, and the step you are provided.
    Use the tools to the best of your ability. Ask a question if required.
    
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
    """

    solve_messages = [
        {"role": "system", "content": EXECUTOR_SYSTEM_PROMPT}
    ]
    solve_messages.extend(messages)

    response = openai_client.chat.completions.create(
        model="gpt-4-1106-preview",
        messages=solve_messages,
        tools=executor_tools_openai,
        tool_choice="auto",
        max_tokens=512
    )

    tool_functions = get_executor_tools(directory)

    response_message = response.choices[0].message
    tool_calls = response_message.tool_calls

    return_messages = [
        response_message.model_dump()
    ]

    if tool_calls:
        for tool_call in tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            function_response = tool_functions[function_name](function_args)
            return_messages.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "name": function_name,
                "content": function_response
            })
    else:
        return_messages.append({
            "role": "assistant",
            "content": f"Executor bot says: \n {response_message.content}"
        })
    
    return return_messages