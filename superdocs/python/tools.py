from langchain.tools.file_management import (
    ReadFileTool,
    CopyFileTool,
    DeleteFileTool,
    MoveFileTool,
    WriteFileTool,
    ListDirectoryTool,
)
from langchain.agents.agent_toolkits import FileManagementToolkit
from langchain.tools import ShellTool
from website_content_tool import get_website_content
from langchain.tools import MetaphorSearchResults, StructuredTool
from langchain.utilities import MetaphorSearchAPIWrapper
from langchain.agents import initialize_agent, Tool, tool
from langchain.agents import AgentType
from dotenv import load_dotenv
from trafilatura import fetch_url, extract
from pydantic import BaseModel, Field
from langchain.utilities import GoogleSerperAPIWrapper
import os

from langchain.agents.agent_toolkits import (
    create_vectorstore_agent,
    VectorStoreToolkit,
    VectorStoreInfo,
)

load_dotenv(".env")

@tool("get_website_content", return_direct=True)
def get_website_content(url: str) -> str:
    """Extracts the text from the url queried."""
    downloaded = fetch_url(url)
    result = extract(downloaded)
    return result

class ReplaceTextInFileInput(BaseModel):
    filepath: str = Field(description="Filepath to file you want to modify, relative to the current directory")
    original_text: str = Field(description="Original text you want to replace")
    new_text: str = Field(description="Text you want to replace the original text with")

def gen_replacer(directory):
    def replace_text_in_file(filepath, original_text, new_text):
        # try:
        with open(os.path.join(directory, filepath), 'r') as file:
            file_content = file.read()

        if original_text in file_content:
            updated_content = file_content.replace(original_text, new_text)

            with open(os.path.join(directory, filepath), 'w') as file:
                file.write(updated_content)

            return "Text replaced successfully."
        else:
            return "Original text not found in the file."
        # except FileNotFoundError:
        #     print(f"File '{filename}' not found.")
        # except Exception as e:
        #     print(f"An error occurred: {e}")
    return replace_text_in_file

def get_tools(directory):
    # search = MetaphorSearchAPIWrapper()
    search = GoogleSerperAPIWrapper()
    tools = [
        Tool(
            name="Google Search",
            func=search.run,
            description="useful for when you need to ask with search",
        )
    ]

    # metaphor_tool = MetaphorSearchResults(api_wrapper=search)
    # tools.append(metaphor_tool)

    file_toolkit = FileManagementToolkit(
        root_dir=directory,
        selected_tools=["read_file", "write_file", "list_directory", "file_search"],
        # callback_manager=cm
    )
    tools.extend(file_toolkit.get_tools())

    replace_tool = StructuredTool.from_function(
        func=gen_replacer(directory),
        name="Replace Text In File",
        description="Useful for when you want to replace one piece of text in a file with another piece of text.",
        args_schema=ReplaceTextInFileInput
    )

    tools.append(get_website_content)
    tools.append(ShellTool())
    tools.append(replace_tool)
    return tools

def get_tools_non_editing(directory):
    search = MetaphorSearchAPIWrapper()
    tools = []
    metaphor_tool = MetaphorSearchResults(api_wrapper=search)
    tools.append(metaphor_tool)

    file_toolkit = FileManagementToolkit(
        root_dir=directory,
        selected_tools=["read_file", "list_directory", "file_search"],
        # callback_manager=cm
    )
    tools.extend(file_toolkit.get_tools())
    tools.append(get_website_content)
    return tools

def generate_tools_for_directory():
    pass

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