from langchain.tools.file_management import (
    ReadFileTool,
)
from langchain.agents.agent_toolkits import FileManagementToolkit, create_retriever_tool
from langchain.tools.file_management import ReadFileTool
from langchain.tools import StructuredTool, ShellTool
from langchain.agents import initialize_agent, Tool, tool
from dotenv import load_dotenv
from trafilatura import fetch_url, extract
from pydantic import BaseModel, Field
from typing import Optional
from langchain.callbacks.manager import CallbackManagerForToolRun
from googlesearch import search
import search_retrieval
import os

load_dotenv(".env")

class MarkdownReadFileTool(ReadFileTool):
    def _run(
            self,
            file_path: str,
            run_manager: Optional[CallbackManagerForToolRun] = None
    ) -> str:
        extension = file_path.split(".")[-1]
        normal_output = super()._run(file_path=file_path, run_manager=run_manager)
        return "```" + extension + "\n" + normal_output + "\n" + "```"

@tool("get_website_content", return_direct=True)
def get_website_content(url: str) -> str:
    """Extracts all the text from the url queried."""
    downloaded = fetch_url(url)
    result = extract(downloaded)
    return result

@tool("google_search", return_direct=True)
def get_google_search(query: str) -> str:
     """Get the top 3 links from a Google Search about a particular topic. Useful for looking up documentation. Google searches should be about a singular specific topic only."""
     return search_retrieval.retrieve_content(query)

# class ReplaceTextInFileInput(BaseModel):
#     filepath: str = Field(description="Filepath to file you want to modify, relative to the current directory")
#     original_text: str = Field(description="Original text you want to replace")
#     new_text: str = Field(description="Text you want to replace the original text with")

# def gen_replacer(directory):
#     def replace_text_in_file(filepath, original_text, new_text):
#         # try:
#         with open(os.path.join(directory, filepath), 'r') as file:
#             file_content = file.read()

#         if original_text in file_content:
#             updated_content = file_content.replace(original_text, new_text)

#             with open(os.path.join(directory, filepath), 'w') as file:
#                 file.write(updated_content)

#             return "Text replaced successfully."
#         else:
#             return "Original text not found in the file."
#         # except FileNotFoundError:
#         #     print(f"File '{filename}' not found.")
#         # except Exception as e:
#         #     print(f"An error occurred: {e}")
#     return replace_text_in_file

def get_retrieval_tools(directory, vectorstore=None):
    tools = []
    # file_toolkit = FileManagementToolkit(
    #     root_dir=directory,
    #     selected_tools=["list_directory", "file_search"]
    # )
    # tools.extend(file_toolkit.get_tools())

    # tools.append(MarkdownReadFileTool())
    tools.append(get_website_content)
    tools.append(get_google_search)

    if vectorstore:
        tools.append(
            create_retriever_tool(
                vectorstore.as_retriever(),
                "search_code_vectorstore",
                "Semantically searches codebase for information. Your query should be in the format of keywords separated by spaces."
            )
        )

    return tools

def get_writing_tools(directory):
    # search = MetaphorSearchAPIWrapper()
    tools = []

    # metaphor_tool = MetaphorSearchResults(api_wrapper=search)
    # tools.append(metaphor_tool)

    # file_toolkit = FileManagementToolkit(
    #     root_dir=directory,
    #     selected_tools=["write_file"],
    #     # callback_manager=cm
    # )
    # tools.extend(file_toolkit.get_tools())

    # replace_tool = StructuredTool.from_function(
    #     func=gen_replacer(directory),
    #     name="replace_text_in_file",
    #     description="Useful for when you want to replace one piece of text in a file with another piece of text.",
    #     args_schema=ReplaceTextInFileInput
    # )

    # tools.append(get_website_content)
    # tools.append(get_google_search)
    # tools.append(ShellTool())
    # tools.append(replace_tool)

    # print("Returning tools: ", tools)

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