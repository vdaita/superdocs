import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForCausalLM
import transformers
import difflib
from diff_utils import find_best_match, parse_diff
from typing import List, Optional, Tuple
from transformers.generation.candidate_generator import CandidateGenerator, _crop_past_key_values
from transformers.generation.stopping_criteria import StoppingCriteria
from transformers.generation.configuration_utils import GenerationConfig

model_name = "Qwen/Qwen2-7B-Instruct-MLX"
draft_model_name = "Qwen/Qwen2-0.5B-Instruct-MLX"
tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)

model = AutoModelForCausalLM.from_pretrained(model_name, trust_remote_code=True, device_map="auto")
draft_model = AutoModelForCausalLM.from_pretrained(draft_model_name, trust_remote_code=True, device_map="auto")

NEWLINE_THRESHOLD = 10
newline_token = tokenizer.encode("""
""")[-1]

@torch.no_grad() # Pulled directly from the demo_pld notebook.
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
    return torch.tensor([100], dtype=torch.long, device=input_ids.device)

@torch.no_grad()
def find_candidate_pred_tokens_diff(input_ids, code_ids, orig_input_len=0, ngram_size=3, num_pred_tokens=10):
    # start_time = time.perf_counter()
    input_length = input_ids.size(1)
    code_length = len(code_ids)

    # Ensure max_ngram_size and num_pred_tokens are valid
    if ngram_size <= 0 or ngram_size > input_length:
        raise ValueError("Invalid max_ngram_size or num_pred_tokens")

    sm = difflib.SequenceMatcher(None, code_ids, input_ids[0, orig_input_len:].tolist())
    
    deleted = added = changed = same = last_deleted = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'replace':
            changed += i2 - i1
        elif tag == 'delete':
            deleted += i2 - i1
            last_deleted = i2 - i1
        elif tag == 'insert':
            added += j2 - j1
        elif tag == 'equal':
            same += i2 - i1
    
    approx_tokens_original = changed + deleted + same - last_deleted

    lookback_start = max(input_length - ngram_size, orig_input_len)
    search_ngram = input_ids[0, lookback_start:].tolist()

    for ngram_start in range(max(0, approx_tokens_original - ngram_size), len(code_ids)):
        # if there is a match, return the entire rest of the tokens.
        if ngram_start + len(search_ngram) >= len(code_ids):
            break
        if search_ngram == code_ids[ngram_start:ngram_start + len(search_ngram)]:
            return torch.tensor(code_ids[ngram_start + len(search_ngram):max(ngram_start + len(search_ngram) + num_pred_tokens, len(code_ids))], dtype=torch.long, device=input_ids.device)

    # If no match is found, return what the answer would be otherwise
    # print("Diff searching took: ", time.perf_counter() - start_time)
    return find_candidate_pred_tokens(input_ids, ngram_size, num_pred_tokens)
    # return torch.tensor([], dtype=torch.long, device=input_ids.device)


class DiffPromptLookupCandidateGenerator(CandidateGenerator):
    def __init__(self, input_ids, code_ids, ngram_size=3, num_pred_tokens=10):
        self.code_ids = code_ids
        self.orig_input_len = input_ids.shape[-1]
        self.ngram_size = ngram_size
        self.num_pred_tokens = num_pred_tokens
    
    def get_candidates(self, input_ids: torch.LongTensor) -> Tuple[torch.LongTensor, Optional[torch.FloatTensor]]:
        # print("Getting candidates")
        return torch.cat(
            (
                input_ids,
                find_candidate_pred_tokens_diff(input_ids, self.code_ids, self.orig_input_len, self.ngram_size, self.num_pred_tokens).unsqueeze(0)
            ),
            dim=-1
        ), None
    
    def update_candidate_strategy(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, num_matches: int): # Maybe use the number of matches/scores to have a threshold
        pass 

class NumRunsStoppingCriteria(StoppingCriteria):
    def __init__(self, max_num_runs=4):
        self.max_num_runs = 4
        self.num_runs = 0

    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, **kwargs) -> torch.BoolTensor:
        self.num_runs += 1
        return self.num_runs >= self.max_num_runs

def _get_default_candidate_generator_generator(generator: CandidateGenerator):
    def _get_candidate_generator(self, **kwargs):
        return generator
    return _get_candidate_generator

class TwoLayerLookupCandidateGenerator(CandidateGenerator):
    def __init__(self, draft_model, input_ids, code_ids, num_runs=4, **diff_prompt_args):
        self.draft_model = draft_model
        self.input_ids = input_ids
        self.code_ids = code_ids
        self.candidate_generator = DiffPromptLookupCandidateGenerator(
            self.input_ids, 
            self.code_ids,
            **diff_prompt_args
        )
        
        self.past_keys_values = None
        self.num_runs = num_runs

        self.draft_model._get_candidate_generator = (_get_default_candidate_generator_generator(self.candidate_generator)).__get__(self.draft_model, type(self.draft_model))

    def get_candidates(self, input_ids: torch.LongTensor) -> Tuple[torch.LongTensor, Optional[torch.FloatTensor]]:
        if self.past_keys_values:
            self.past_keys_values = _crop_past_key_values(self.draft_model, self.past_keys_values, input_ids.shape[-1] - 1)
        
        generation = self.draft_model.generate(
            inputs=input_ids,
            prompt_lookup_num_tokens=1,
            max_new_tokens=1000,
            stopping_criteria=[NumRunsStoppingCriteria(self.num_runs)],
            past_key_values=self.past_keys_values,
            use_cache=True,
            output_scores=True,
            return_dict_in_generate=True
        )

        return generation.sequences, None

    def update_candidate_strategy(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, num_matches: int): # Maybe use the number of matches/scores to have a threshold
        pass

