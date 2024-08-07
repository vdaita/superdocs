from dotenv import load_dotenv
import os

from groq import Groq

load_dotenv(".env")

filepath = "/Users/vijay/Documents/projects/repohelper/pages/index.js"
file_contents = open(filepath, "r").read()

client = Groq(
    api_key=os.environ.get("GROQ_API_KEY"),
)

chat_completion = client.chat.completions.create(
    messages=[
        {
            "role": "user",
            "content": f"",
        }
    ],
    model="llama3-8b-8192",
)

print(chat_completion.choices[0].message.content)