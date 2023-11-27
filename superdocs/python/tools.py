from langchain.agents.agent_toolkits import create_retriever_tool
from langchain.agents import tool
from search_retrieval import summarize_relevantly
from dotenv import load_dotenv
from trafilatura import fetch_url, extract
from googlesearch import search
import json

load_dotenv(".env")

def generate_website_request(model):
    @tool("get_website_content", return_direct=True)
    def get_website_content(url: str, question: str) -> str:
        """Extracts all the text from the url queried."""
        downloaded = fetch_url(url)
        result = extract(downloaded)
        
        if model:
            return summarize_relevantly(result, question, model)
        else:
            return result

    return get_website_content

@tool("google_search", return_direct=True)
def get_google_search(query: str) -> str:
     """Get the top 5 links from a Google Search about a particular topic. Useful for looking up documentation. Google searches should be about a singular specific topic only."""
     json_obj = []
     results = search(query, advanced=True)
     for result in results:
         json_obj.append({
            "title": result.title,
            "url": result.url,
            "description": result.description 
         })
     return json.dumps(json_obj)

def get_retrieval_tools(directory, vectorstore=None, model=None):
    tools = []
    tools.append(generate_website_request(model))
    tools.append(get_google_search)

    if vectorstore:
        tools.append(
            create_retriever_tool(
                vectorstore.as_retriever(),
                "search_code_vectorstore",
                "Semantically searches the user's current local for information. Your query should be in the format of keywords separated by spaces."
            )
        )

    return tools

# https://github.com/microsoft/autogen/blob/main/notebook/agentchat_langchain.ipynb
def generate_autogen_tool_schema(tool):
    function_schema = {
        "name": tool.name.lower().replace (' ', '_'),
        "description": tool.description,
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    }

    if tool.args is not None:
      function_schema["parameters"]["properties"] = tool.args

    return function_schema