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
import os

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


def get_tools(directory, cm):
    search = MetaphorSearchAPIWrapper()
    tools = []
    metaphor_tool = MetaphorSearchResults(api_wrapper=search)
    tools.append(metaphor_tool)

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
    tools.append(ShellTool(callback_manager=cm))
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