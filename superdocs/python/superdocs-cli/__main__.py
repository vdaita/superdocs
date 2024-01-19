from flask import request
from langchain.embeddings import HuggingFaceEmbeddings
from .repo import list_non_ignored_files, find_closest_file, get_documents
from .diff_management import fuzzy_process_diff
from openai import OpenAI
import json
import tiktoken
from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS, cross_origin
import os
import logging
import re
from googlesearch import search
from trafilatura import fetch_url, extract

from llama_index.vector_stores import ChromaVectorStore
from llama_index.retrievers import BM25Retriever
from llama_index import VectorStoreIndex, StorageContext, ServiceContext, QueryBundle
from llama_index.postprocessor import SentenceTransformerRerank, LLMRerank
from llama_index.schema import Node

from .prompts import EXTERNAL_SEARCH_PROMPT, SEMANTIC_SEARCH_PROMPT, LEXICAL_SEARCH_PROMPT, FILE_READ_PROMPT, QA_PROMPT, EXECUTOR_SYSTEM_PROMPTS, EXECUTOR_SYSTEM_REMINDER, CONDENSE_QUERY_PROMPT, INFORMATION_EXTRACTION_SYSTEM_PROMPT, PLANNING_SYSTEM_PROMPT
from .hybrid_retriever import HybridRetriever
from .search_retrieval import retrieve_content

load_dotenv()

## Together.ai
# openai_client = OpenAI(
#     api_key=os.environ["TOGETHER_API_KEY"],
#     base_url="https://api.together.xyz/v1"
# )
# model_name="Phind/Phind-CodeLlama-34B-v2"
# model_temperature=0.5

# OpenRouter
# openai_client = OpenAI(
#     api_key=os.environ["OPENROUTER_API_KEY"],
#     base_url="https://openrouter.ai/api/v1"
# )

# model_name = "phind/phind-codellama-34b"
# model_temperature=0.1

## OpenAI
openai_client = None

api_key = ""
base_url = ""
model_name = "gpt-4-1106-preview"
auxiliary_model_name = ""

encoding = tiktoken.get_encoding("cl100k_base")

model_temperature=0.1

test_response = """
```diff\n--- /dev/null\n+++ src/pages/api/openai.ts\n@@ ... @@\n+import { NextApiRequest, NextApiResponse } from 'next';\n+import OpenAI from 'openai-api';\n+\n+// Initialize OpenAI with your API Key\n+const openai = new OpenAI(process.env.OPENAI_API_KEY);\n+\n+// Async function to get a response from OpenAI\n+async function getOpenAIResponse(prompt: string) {\n+  const response = await openai.complete({\n+    engine: 'davinci',\n+    prompt: prompt,\n+    maxTokens: 150,\n+    temperature: 0.7,\n+    topP: 1,\n+    frequencyPenalty: 0,\n+    presencePenalty: 0,\n+  });\n+  return response.data.choices[0].text.trim();\n+}\n+\n+// API route to handle requests\n+export default async (req: NextApiRequest, res: NextApiResponse) => {\n+  if (req.method === 'POST') {\n+    const { prompt } = req.body;\n+    try {\n+      const openAIResponse = await getOpenAIResponse(prompt);\n+      res.status(200).json({ result: openAIResponse });\n+    } catch (error) {\n+      res.status(500).json({ error: 'Error fetching response from OpenAI' });\n+    }\n+  } else {\n+    res.setHeader('Allow', ['POST']);\n+    res.status(405).end(`Method ${req.method} Not Allowed`);\n+  }\n+};\n```\n\n```diff\n--- src/components/FormulaAssistant.tsx\n+++ src/components/FormulaAssistant.tsx\n@@ ... @@\n export default function FormulaAssistant() {\n   const [query, setQuery] = useState('');\n   const [software, setSoftware] = useState('excel');\n   const [result, setResult] = useState('');\n \n   const process = async () => {\n-    // TODO: Implement the call to the OpenAI API\n+    try {\n+      const response = await fetch('/api/openai', {\n+        method: 'POST',\n+        headers: {\n+          'Content-Type': 'application/json',\n+        },\n+        body: JSON.stringify({ prompt: `${query} in ${software}` }),\n+      });\n+      if (!response.ok) {\n+        throw new Error('Network response was not ok');\n+      }\n+      const data = await response.json();\n+      setResult(data.result);\n+    } catch (error) {\n+      console.error('There was an error processing the request', error);\n+    }\n   };\n \n   // Rest of the component remains unchanged\n }\n```\n\nPlease ensure that you have the `openai-api` package installed in your project and that you have set the `OPENAI_API_KEY` in your environment variables for the above code to work correctly.
"""

app = Flask(__name__)
cors = CORS(app, resources={r"/*": {"origins": "*"}})
logging.getLogger('flask_cors').level = logging.DEBUG

embeddings = HuggingFaceEmbeddings(model_name="TaylorAI/bge-micro-v2")
db = {
    "vectorstore_index": None,
    "retriever": None,
    "directory": None,
    "hybrid_retriever": None
}

reranker = SentenceTransformerRerank(top_n=8, model="BAAI/bge-reranker-base")

def chunk_text_with_overlap(text, chunk_size, overlap):
    """
    Breaks text into n-character chunks with k overlap.

    Args:
        text (str): The input text.
        chunk_size (int): The size of each chunk.
        overlap (int): The number of characters to overlap between chunks.

    Returns:
        List of chunks.
    """
    chunks = []
    text_length = len(text)

    # Iterate through the text with the specified overlap
    for start in range(0, text_length, chunk_size - overlap):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)

    return chunks


def generate_website_documents(website: str):
    results = search(f"site:{website}", num_results=100, advanced=True, timeout=5)
    separated_documents = []
    for result in results:
        downloaded = fetch_url(result.url)
        separated_documents.extend(chunk_text_with_overlap(downloaded, 500, 50))
    return separated_documents
        

def self_evaluated_gpt(task, query, previous_response=None, iterations=3):
    if not(previous_response):
        pass
    model_response = openai_client.chat.completions.create(
        model=model_name,
        messages=[{
            "role": "system",
            "content": task
        },
        ],
        temperature=model_temperature
    )   
    model_response_text = model_response.choices[0].message.content
    while not("DONE" in model_response_text):
        return self_evaluated_gpt(task, query, previous_response, iterations=iterations-1)
    pass

def get_retrieval_tools(directory):
    def combined_search(args):
        query = args["query"]
        nodes = db["hybrid_retriever"].retrieve(query)
        reranked_nodes = reranker.postprocess_nodes(nodes, query_bundle=QueryBundle(
            query
        ))    
        response = ""
        for index, node in enumerate(reranked_nodes):
            response += f"Snippet {index}: {node.get_text()} \n \n"
        return response    
    def external_search(args):
        query = args["query"]
        return retrieve_content(query, api_key, base_url, auxiliary_model_name)
    
    def read_file(args):
        filepath = args["query"]
        closest_filepath = find_closest_file(directory, filepath)
        if not(closest_filepath):
            return "Filepath does not exist"
        try: 
            file = open(os.path.join(directory, closest_filepath), "r")
            contents = file.read()
            file.close()
            return f"File contents of: {closest_filepath} \n \n ```\n{contents}\n```"
        except:
            return f"File {closest_filepath} could not be found."
    return {
        "external": external_search,
        "file": read_file,
        "codebase": combined_search
    }
    # return ['external', 'semantic', 'lexical', 'file'], [external_search, semantic_search, lexical_search, read_file]

def extract_content(text, tag):
 pattern = r'<' + tag + '>(.*?)</' + tag + '>'
 matches = re.findall(pattern, text, re.DOTALL)
 return matches

def extract_diff_code_blocks(md_text):
   # Regular expression pattern for matching diff code blocks
   pattern = r'```diff([\s\S]*?)```'
   # Find all diff code blocks using the pattern
   diff_code_blocks = re.findall(pattern, md_text, re.MULTILINE)
   return diff_code_blocks

def extract_information_from_query(query: str, existing_content: list, directory: str, run_until_done=False):
    print("Extract information from query: ", query, existing_content)
    global db
    context = existing_content

    messages = [
        {
            "role": "system",
            "content": INFORMATION_EXTRACTION_SYSTEM_PROMPT
        },
        {
            "role": "user",
            "content": f"User's current files: \n {list_non_ignored_files(directory)}"
        }
    ]

    for context_item in context:
        messages.append({
            "role": "user",
            "content": context_item
        })

    messages.append({
            "role": "user",
            "content": f"User objective: {query}"
        })

    response = openai_client.chat.completions.create(
        model=model_name,
        messages=messages,
        max_tokens=512
    )
    response_message = response.choices[0].message.content
    print("Response message: ", response_message)

    tool_functions = get_retrieval_tools(directory)
    
    extractions_count = 0

    for tool_name in tool_functions.keys():
        extractions = extract_content(response_message, tool_name)
        extractions_count += len(extractions)
        for extraction in extractions:
            extracted_content = tool_functions[tool_name]({
                "query": extraction
            })
            context.append(extracted_content)
    
    if run_until_done:
        if extractions_count == 0:
            return extract_information_from_query()

    return context

@app.post("/define_models")
def define_models():
    global openai_client
    global model_name
    global auxiliary_model_name
    global base_url
    global api_key

    data = request.get_json()
    print("Received data from frontend: ", data)

    openai_client = OpenAI(
        api_key=data["apiKey"],
        base_url=data["apiUrl"]
    )
    model_name = data["modelName"]
    auxiliary_model_name = data["auxiliaryModelName"]
    base_url = data["apiUrl"]
    api_key = data["apiKey"]
    
    return {"ok": True}


@app.post("/load_vectorstore")
def load_vectorstore():
    data = request.get_json()
    directory = data["directory"]
    print("Loading the vectorstore....")
    documents = get_documents(directory, api_key=api_key, model_name=auxiliary_model_name, base_url=base_url)
    # documents = [Node(text="test")]
    print("Got the documents... ", len(documents), type(documents[0]))

    storage_context = StorageContext.from_defaults()
    db["vectorstore"] = VectorStoreIndex(
        nodes=documents,
        storage_context=storage_context,
    )
    db["retriever"] = BM25Retriever.from_defaults(nodes=documents, similarity_top_k=20)
    db["hybrid_retriever"] = HybridRetriever(db["vectorstore"].as_retriever(similarity_top_k=20), db["retriever"])

    db["directory"] = directory
    return {"ok": True}

@app.post("/information")
def extract_information():
    data = request.get_json()
    directory = data["directory"]
    objective = data["objective"]
    context = data["context"]
    return {
        "context": extract_information_from_query(objective, context, directory)
    }
    

@app.post("/plan")
def break_down_problem(): 
    # TODO: Have the user's objective be stated with OBJECTIVE to make it more clear to the model.
    data = request.get_json()
    directory = data["directory"]
    context = data["context"]
    objective = data["objective"]

    print("Received: ", data)

    plan_changes_messages = [
        {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
    ]
    for context_item in context:
        plan_changes_messages.append({
            "role": "user",
            "content": context_item
        })
    plan_changes_messages.append({
        "role": "user",
        "content": f"Objective: {objective}"
    })

    response = openai_client.chat.completions.create(
        model=model_name,
        messages=plan_changes_messages,
        temperature=model_temperature
    )
    response_message = response.choices[0].message.content

    print("Response message: ", response_message)

    return {"plan": response_message}

@app.post("/chat")
def chat():
    data = request.get_json()
    directory = data["directory"]
    messages = data["messages"]

    context = data["context"] # Chat messages use previously retrieved context.

    message_history_string = ["\n\n".join([f"${message['role'].capitalize()}: ${message['content']}" for message in messages[-8:-1]])]
    current_question = messages[-1]["content"]
    condense_query_response = openai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "user", "content": f"Chat history: {message_history_string} \n \n \n {CONDENSE_QUERY_PROMPT}: {current_question}"}
        ],
        temperature=model_temperature,
        max_tokens=200
    )
    condense_query_response = condense_query_response.choices[0].message.content

    new_information = extract_information_from_query(condense_query_response, context, directory)
    contextual_answer_response = openai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": QA_PROMPT}
        ],
        temperature=model_temperature,
        max_tokens=300
    )
    contextual_answer = contextual_answer_response.choices[0].message.content

    return {
        "context": new_information,
        "answer": {
            "role": "assistant",
            "content": contextual_answer
        }
    }


@app.post("/execute")
def solve_problem():
    global model_name
    global model_temperature

    data = request.get_json()
    directory = data["directory"]
    plan = data["plan"]
    context = data["context"]
    token_limit = data["tokenLimit"]
    
    print("Received: ", data)
    context = "\n".join(context)

    solve_messages = [
        {"role": "system", "content": EXECUTOR_SYSTEM_PROMPTS},
        {"role": "system", "content": EXECUTOR_SYSTEM_REMINDER},
        {"role": "user", "content": f"## Context: \n \n {context}"},
        {"role": "user", "content": f"Plan to implement: \n {plan}"}
    ]

    total_token_count = 0
    print()

    for message in solve_messages:
        message_token_length = len(encoding.encode(message["content"]))
        print("Processed a message")
        total_token_count += message_token_length
    print("Total token length: ", total_token_count);


    response = openai_client.chat.completions.create(
        model=model_name,
        messages=solve_messages,
        max_tokens=2048,
        temperature=model_temperature
    )


    return_messages = []

    print("Received response: ", response)
    response_message = response.choices[0].message.content

    # response_message = test_response
    code_blocks = extract_diff_code_blocks(response_message)

    print("\n")
    print("Code blocks received: ", code_blocks)

    replacements = []
    for code_block in code_blocks:
        replacements.extend(fuzzy_process_diff(directory, code_block))
    
    for replacement in replacements:
        return_messages.append({
            "type": "changes",
            "content": replacement
        })
    
    return_messages.append({
        "type": "message",
        "content": response_message
    })
    print("Returning messages: ", return_messages)
    
    return {"execution": return_messages}

def start_server():
    app.run(port=8123, debug=True)

if __name__ == "__main__":
    start_server()


# if __name__ == "__main__":
#     typer.run(run)