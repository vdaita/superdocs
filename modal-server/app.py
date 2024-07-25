import os
import time

import modal

GPU_CONFIG = modal.gpu.A10G(count=1)

image = modal.Image.debian_slim().pip_install(
    "transformers==4.35.2",
    "accelerate",
    "torch",
    "tokenizers",
    "fastapi"
)

app = modal.App("superdocs-server")

@app.cls(
    gpu=GPU_CONFIG,
    timeout=60 * 10,
    container_idle_timeout=60 * 10,
    allow_concurrent_inputs=10,
    image=image,
)
class Model:

    @modal.enter()
    def load_models(self):
        from transformers import AutoModelForCausalLM, AutoTokenizer, StoppingCriteriaList, MaxLengthCriteria
        from tokenizers import Tokenizer
        from transformers.generation.utils import _crop_past_key_values 
        from typing import Optional, Union, List
        import torch
        import copy

        target_model_name = "nuprl/EditCoder-6.7b-v1"
        draft_model_name = "deepseek-ai/deepseek-coder-1.3b"

        self.target_model = AutoModelForCausalLM.from_pretrained(target_model_name, trust_remote_code=True, device_map="auto", torch_dtype=torch.float16, use_flash_attention_2=True)
        self.draft_model = AutoModelForCausalLM.from_pretrained(draft_model_name, trust_remote_code=True, device_map="auto", load_in_4bit=True, torch_dtype=torch.float16, use_flash_attention_2=True)
        self.tokenizer = AutoTokenizer.from_pretrained(draft_model_name)
                
        NEWLINE_THRESHOLD = 5

        @torch.no_grad()
        def find_candidate_pred_tokens(input_ids, max_ngram_size=3, num_pred_tokens=10):
            input_length = input_ids.size(1)
            if max_ngram_size <= 0 or num_pred_tokens <= 0 or max_ngram_size > input_length:
                raise ValueError("Invalid max_ngram_size or num_pred_tokens")
            for ngram_size in range(max_ngram_size, 0, -1):
                ngram = input_ids[0, -ngram_size:].tolist()
                windows = input_ids.unfold(dimension=1, size=ngram_size, step=1)
                ngram_tensor = torch.tensor(ngram, device=input_ids.device).unsqueeze(0)
                matches = (windows == ngram_tensor).all(dim=2)
                match_indices = matches.nonzero(as_tuple=True)[1]
                for idx in match_indices:
                    start_idx = idx + ngram_size
                    end_idx = start_idx + num_pred_tokens
                    if start_idx < input_length - ngram_size:
                        return input_ids[0, start_idx:min(end_idx, input_length)]
            return torch.tensor([], dtype=torch.long, device=input_ids.device)
        
        @torch.no_grad()
        def assistant_decode(
                self,
                input_ids: torch.LongTensor,
                stopping_criteria: Optional[StoppingCriteriaList] = None,
                pad_token_id: Optional[int] = None,
                eos_token_id: Optional[Union[int, List[int]]] = None,
                output_attentions: Optional[bool] = None,
                output_hidden_states: Optional[bool] = None,
                prompt_matching_window_size = 3,
                prompt_num_candidate_tokens = 10,
                draft_num_candidate_rounds = 4,
                **model_kwargs,
            ):
                # init values
                stopping_criteria = stopping_criteria if stopping_criteria is not None else StoppingCriteriaList()
                pad_token_id = pad_token_id if pad_token_id is not None else self.generation_config.pad_token_id
                eos_token_id = eos_token_id if eos_token_id is not None else self.generation_config.eos_token_id
                if isinstance(eos_token_id, int):
                    eos_token_id = [eos_token_id]
                eos_token_id_tensor = torch.tensor(eos_token_id).to(input_ids.device) if eos_token_id is not None else None
                scores = None

                max_len = stopping_criteria[0].max_length

                i = 0

                input_token_len = input_ids.shape[-1]
            
                for i in range(draft_num_candidate_rounds):
                    i += 1
                    cur_len = input_ids.shape[-1]

                    candidate_pred_tokens = find_candidate_pred_tokens(input_ids, prompt_matching_window_size, prompt_num_candidate_tokens)

                    if len(candidate_pred_tokens) == 0:
                        candidate_pred_tokens = torch.tensor([100], device=input_ids.device).unsqueeze(0)
                    else:
                        candidate_pred_tokens = candidate_pred_tokens.unsqueeze(0)
                    candidate_pred_tokens = candidate_pred_tokens.to(self.device)
                    
                    candidate_input_ids = torch.cat((input_ids, candidate_pred_tokens), dim=1)
                    
                    candidate_length = candidate_input_ids.shape[1] - input_ids.shape[1]

                    candidate_kwargs = copy.copy(model_kwargs)
                    candidate_kwargs = self._extend_attention_mask(candidate_kwargs, candidate_input_ids.shape[1])
                    candidate_kwargs = self._extend_token_type_ids(candidate_kwargs, candidate_input_ids.shape[1])

                    model_inputs = self.prepare_inputs_for_generation(candidate_input_ids, **candidate_kwargs)
                    outputs = self(
                        **model_inputs,
                        return_dict=True,
                        output_attentions=output_attentions,
                        output_hidden_states=output_hidden_states,
                    )

                    new_logits = outputs.logits[:, -candidate_length - 1 :]  # excludes the input prompt if present
                    selected_tokens = new_logits.argmax(dim=-1)
                    candidate_new_tokens = candidate_input_ids[:, -candidate_length:]
                    n_matches = ((~(candidate_new_tokens == selected_tokens[:, :-1])).cumsum(dim=-1) < 1).sum()
                    
                    n_matches = min(n_matches, max_len - cur_len - 1)
                    valid_tokens = selected_tokens[:, : n_matches + 1]
                    input_ids = torch.cat((input_ids, valid_tokens), dim=-1)
                    new_cur_len = input_ids.shape[-1]

                    if input_ids.shape[-1] > NEWLINE_THRESHOLD: # Check that there are max 5 consecutive newlines.
                        flag = True
                        for i in range(NEWLINE_THRESHOLD):
                            if not(input_ids[0, -i] == 185): # Is the newline token for Deepseek Coder models
                                flag = False
                        if flag:
                            break
                        
                    new_cache_size = new_cur_len - 1
                    outputs.past_key_values = _crop_past_key_values(self, outputs.past_key_values, new_cache_size)

                    model_kwargs["past_key_values"] = outputs.past_key_values
                    if (valid_tokens == eos_token_id_tensor.item()).any():
                        break
                    
                    if stopping_criteria(input_ids, scores):
                        break


                return input_ids[0, input_token_len:], model_kwargs
        
        @torch.no_grad()
        async def greedy_search_assistant_pld(
                self,
                input_ids: torch.LongTensor,
                assistant_model: torch.nn.Module,
                tokenizer: Tokenizer,
                stopping_criteria: Optional[StoppingCriteriaList] = None,
                pad_token_id: Optional[int] = None,
                eos_token_id: Optional[Union[int, List[int]]] = None,
                output_attentions: Optional[bool] = None,
                output_hidden_states: Optional[bool] = None,
                output_scores: Optional[bool] = None,
                return_dict_in_generate: Optional[bool] = None,
                assistant_prompt_matching_window_size = 3,
                assistant_prompt_candidate_tokens = 10,
                assistant_draft_candidate_rounds = 4,
                max_draft_num_candidate_tokens = 300,
                **model_kwargs,
            ):

                # init values
                stopping_criteria = stopping_criteria if stopping_criteria is not None else StoppingCriteriaList()
                pad_token_id = pad_token_id if pad_token_id is not None else self.generation_config.pad_token_id
                eos_token_id = eos_token_id if eos_token_id is not None else self.generation_config.eos_token_id
                if isinstance(eos_token_id, int):
                    eos_token_id = [eos_token_id]
                eos_token_id_tensor = torch.tensor(eos_token_id).to(input_ids.device) if eos_token_id is not None else None

                # # init attention / hidden states / scores tuples
                scores = () if (return_dict_in_generate and output_scores) else None

                max_len = stopping_criteria[0].max_length

                i = 0
                assistant_model_kwargs = {}

                while True:
                    i += 1
                    cur_len = input_ids.shape[-1]                    
                    input_ids = input_ids.to(assistant_model.device)

                    candidate_pred_tokens, assistant_model_kwargs = assistant_model.assistant_greedy_search_pld(input_ids,
                        stopping_criteria=StoppingCriteriaList([MaxLengthCriteria(max_length=cur_len + max_draft_num_candidate_tokens)]),
                        draft_num_candidate_rounds=assistant_draft_candidate_rounds,
                        prompt_matching_window_size=assistant_prompt_matching_window_size,
                        prompt_num_candidate_tokens = assistant_prompt_candidate_tokens,
                        use_cache=True, 
                        pad_token_id=tokenizer.pad_token_id,
                        eos_token_id=tokenizer.eos_token_id,
                            print_output=False
                    )
                    input_ids = input_ids.to(self.device)

                    candidate_pred_tokens = candidate_pred_tokens.to(self.device)

                    if len(candidate_pred_tokens) == 0:
                        candidate_pred_tokens = torch.tensor([100], device=input_ids.device).unsqueeze(0)
                    else:
                        candidate_pred_tokens = candidate_pred_tokens.unsqueeze(0)
                    
                    candidate_input_ids = torch.cat((input_ids, candidate_pred_tokens), dim=1)
                    
                    candidate_length = candidate_input_ids.shape[1] - input_ids.shape[1]

                    candidate_kwargs = copy.copy(model_kwargs)
                    candidate_kwargs = self._extend_attention_mask(candidate_kwargs, candidate_input_ids.shape[1])
                    candidate_kwargs = self._extend_token_type_ids(candidate_kwargs, candidate_input_ids.shape[1])

                    model_inputs = self.prepare_inputs_for_generation(candidate_input_ids, **candidate_kwargs)
                    outputs = self(
                        **model_inputs,
                        return_dict=True,
                        output_attentions=output_attentions,
                        output_hidden_states=output_hidden_states,
                    )

                    new_logits = outputs.logits[:, -candidate_length - 1 :]  # excludes the input prompt if present
                    selected_tokens = new_logits.argmax(dim=-1)
                    candidate_new_tokens = candidate_input_ids[:, -candidate_length:]
                    n_matches = ((~(candidate_new_tokens == selected_tokens[:, :-1])).cumsum(dim=-1) < 1).sum()

                    n_matches = min(n_matches, max_len - cur_len - 1)
                    valid_tokens = selected_tokens[:, : n_matches + 1]
                    input_ids = torch.cat((input_ids, valid_tokens), dim=-1)
                    new_cur_len = input_ids.shape[-1]

                    if input_ids.shape[-1] > NEWLINE_THRESHOLD: # Check that there are max 5 consecutive newlines.
                        flag = True
                        for i in range(NEWLINE_THRESHOLD):
                            if not(input_ids[0, -i] == 185): # Is a newline
                                flag = False
                        if flag:
                            break

                    new_cache_size = new_cur_len - 1
                    outputs.past_key_values = _crop_past_key_values(self, outputs.past_key_values, new_cache_size)
                    if "past_key_values" in assistant_model_kwargs:
                        assistant_model_kwargs["past_key_values"] = _crop_past_key_values(assistant_model, assistant_model_kwargs["past_key_values"], new_cache_size - 1) 
                
                    # yield tokenizer.batch_decode(valid_tokens, skip_special_tokens=True)[0]

                    model_kwargs["past_key_values"] = outputs.past_key_values
                    if (valid_tokens == eos_token_id_tensor.item()).any():
                        break
                    
                    if stopping_criteria(input_ids, scores):
                        break
                
                return tokenizer.batch_decode(input_ids, skip_special_tokens=True)[0]
                # return input_ids

        self.target_model.greedy_search_assistant_pld = greedy_search_assistant_pld.__get__(self.target_model, type(self.target_model))
        self.draft_model.assistant_decode = assistant_decode.__get__(self.draft_model, type(self.draft_model))
        print(f"The model has loaded.")

    @modal.web_endpoint(method="POST", docs=True)
    def generate(self, request: dict):
        from transformers import StoppingCriteriaList, MaxLengthCriteria

        file_contents, edit_instruction = request["file_contents"], request["edit_instruction"]

        formatted = f"# Code Before:\n{file_contents}\n# Instruction: {edit_instruction}\n# Code After:\n"
        inputs = self.tokenizer(formatted, return_tensors="pt")
        return self.target_model.greedy_search_assistant_pld(
            inputs.input_ids,
            self.draft_model,
            attention_mask=inputs.attention_mask,
            stopping_criteria=StoppingCriteriaList([MaxLengthCriteria(max_length=len(inputs.input_ids[0])*2 + 300)]),
            assistant_prompt_matching_window_size = 3,
            assistant_prompt_candidate_tokens = 50,
            assistant_draft_candidate_rounds = 4,
            max_draft_num_candidate_tokens = 300,
            use_cache=True, 
            pad_token_id=self.tokenizer.pad_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
        )

    # TODO: use mamba models to preprocess relevant files and come up with a plan

    @modal.exit()
    def stop_engine(self):
        ...

import requests

@app.local_entrypoint()
def main():
    print("Running local entrypoint")
    model = Model()
    response = requests.post(
        model.generate.web_url,
        json={
            "file_contents": """class CSVParser:
def __init__(self, csv: str):
    self.csv = csv

def contents(self) -> list[list[str]]:
    lines = self.csv.split("\n")
    output = []
    for line in lines:
        output.append(line.split(","))
    return output""",
            "edit_instruction": "Add a function called `header` which returns the first row of a csv file as a list of strings, where every element in the list is a column in the row."
        }
    )
    print(response.text)