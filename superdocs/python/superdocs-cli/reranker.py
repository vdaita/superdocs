from openai import OpenAI
import random
from .prompts import LLM_RERANKER_PROMPT
import re
import json

class LLMReranker():

    def __init__(self, api_key, base_url, model_name):
        self.model_name = model_name
        self.openai = OpenAI(api_key=api_key, base_url=base_url)

    def extract_json_code_blocks(self, md_text):
        # Regular expression pattern for matching diff code blocks
        pattern = r'```json([\s\S]*?)```'
        # Find all diff code blocks using the pattern
        json_code_blocks = re.findall(pattern, md_text, re.MULTILINE)
        return json_code_blocks
    
    def rerank(self, contents, objective, output_count): 
        # random.shuffle(contents)
        scored_snippets = []

        for range_start in range(0, len(contents), 10):
            range_end = max(range_start + 10, len(contents))
            contents_range = contents[range_start:range_end]

            snippets_string = "\n".join([f"\n ### Snippet {index + 1}: \n \n {contents}" for index, contents in enumerate(contents_range)])
            response = self.openai.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": LLM_RERANKER_PROMPT
                    },
                    {
                        "role": "user",
                        "content": f"Objective: {objective}"
                    },
                    {
                        "role": "user",
                        "content": f"# Snippets \n \n {snippets_string}"
                    }
                ],
                model=self.model_name,
                temperature=0.1
            )

            # Should expect a JSON response
            response = response.choices[0].message.content
            json_blocks = self.extract_json_code_blocks(response)

            for block in json_blocks:
                block = json.loads(block)
                print("Block: ", block)
                for item in block:
                    snippet_id = item["snippet_id"]
                    relevance = item["relevance"]
                    
                    if type(snippet_id) is str:
                        snippet_id = int(snippet_id)
                    
                    if type(relevance) is str:
                        relevance = int(relevance)
                    
                    if snippet_id >= 0 and snippet_id < len(contents_range):
                        snippet_text = contents_range[snippet_id - 1]
                        scored_snippets.append((snippet_text, relevance))
        
        scored_snippets = sorted(scored_snippets, key=lambda x: x[1])
        scored_snippets = list(reversed(scored_snippets))

        print("Length of all scored_snippets: ", len(scored_snippets))

        return scored_snippets[:min(output_count, len(scored_snippets))]

            

            
        