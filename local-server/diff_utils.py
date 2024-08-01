from dataclasses import dataclass

@dataclass
class Hunk:
    filepath: str
    text: str

@dataclass
class SearchReplaceChange:
    filepath: str
    search_block: str
    replace_block: str

def find_hunks(diff_string):
    hunks = []
    current_filename = ""
    current_lines = ""
    for line in diff_string.splitlines():
        if line.startswith("---"):
            continue
        elif line.lstrip().startswith("+++"):
            if len(current_filename) > 0:
                hunks.append(Hunk(current_filename, current_lines))
            current_filename = line[3:]
            current_lines = ""
        elif line.lstrip().startswith("@@"):
            if len(current_filename) > 0:
                hunks.append(Hunk(current_filename, current_lines))
            current_lines = ""
        else:
            current_lines += line
            current_lines += "\n"
    hunks.append(Hunk(current_filename, current_lines))
    return hunks

def parse_diff(diff_string):
    hunks = find_hunks(diff_string)
    search_replace_blocks = []

    for hunk in hunks:
        filepath = hunk.filepath
        text = hunk.text

        search_block = ""
        replace_block = ""

        for line in text.splitlines():
            if line.startswith("-"):
                search_block += " " + line[1:] + "\n"
            elif line.startswith("+"):
                replace_block += " " + line[1:] + "\n"
            else:
                search_block += line + "\n"
                replace_block += line + "\n"

        search_replace_blocks.append(
            SearchReplaceChange(filepath, search_block, replace_block)
        )
        filepath = ""
        search_block = ""
        replace_block = ""

    search_replace_blocks.append(
        SearchReplaceChange(filepath, search_block, replace_block)
    )

    return search_replace_blocks

from thefuzz import fuzz

@dataclass
class Match:
    block: str
    score: float

def line_relevant(line):
    return not(len(line.strip()) == 0 or line.startswith("#") or line.startswith("//"))

def find_best_match(query_code: str, original_code: str):
    query_code = query_code.strip()

    original_lines = original_code.splitlines()
    query_lines = query_code.splitlines()

    if len(query_lines) == 0:
        return Match("SUPERDOCSTHISSTRINGWILLNEVEREVERBEFOUND", 100)

    best_match = Match("", -1)

    for start_line in range(len(original_lines)):
        min_end = min(len(original_lines), max(start_line, start_line + len(query_lines) - 5)) # +/- 5 lines for tolerance
        max_end = min(len(original_lines), start_line + len(query_lines) + 5)
        for end_line in range(min_end, max_end):
            full_original_snippet = "\n".join(original_lines[start_line:end_line + 1])

            snippet_from_original = "\n".join([line for line in original_lines[start_line:end_line + 1] if line_relevant(line)]) # the loop already doesn't include max_end
            snippet_from_query = "\n".join([line for line in query_lines if line_relevant(line)])

            stripped_original = " ".join([line.strip() for line in snippet_from_original.splitlines()])
            stripped_query =  " ".join([line.strip() for line in snippet_from_query.splitlines()])

            score = fuzz.ratio(stripped_original, stripped_query)

            # Weighting the first and last lines by 3x
            score += 3*fuzz.ratio(original_lines[start_line], query_lines[0])
            score += 3*fuzz.ratio(original_lines[end_line], query_lines[-1])

            if score > best_match.score:
                best_match = Match(full_original_snippet, score)
    return best_match