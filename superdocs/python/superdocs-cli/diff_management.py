from thefuzz import fuzz
import re
from .repo import find_closest_file
from unidiff import PatchSet
import json
import os
from .sweep_search_and_replace import find_best_match

def fuzzy_process_diff(directory, diff): # expects the contents of a fenced block.
    changes = parse_diff(diff)
    matched_diffs = []

    print()
    print("Changes: ", json.dumps(changes, indent=4))
    print()
    

    for change in changes:
        filepath = change["filepath"]

        original_code = change["original"].strip()
        new_code = change["new"].strip()

        if len(original_code) == 0:
            filepath = directory + "/" + filepath
            filepath = filepath.replace("//", "/")

            matched_diffs.append(
                {
                    "filepath": filepath,
                    "old": original_code,
                    "new": new_code
                }
            )
        else:
            closest_filepath = find_closest_file(directory, filepath, threshold=30)
            print("Found closest filepath in fuzzy_process_diff: ", directory, closest_filepath)

            if directory[-1] == "/":
                closest_filepath = directory + closest_filepath
            else:
                closest_filepath = directory + "/" + closest_filepath
            closest_filepath = closest_filepath.replace("//", "/")

            print("Finalized filepath: ", closest_filepath)
            file = open(closest_filepath, "r")
            contents = file.read()
            file.close()

            grounded_original_code = find_best_match(original_code, contents)
            matched_diffs.append(
                {
                    "filepath": closest_filepath,
                    "old": grounded_original_code,
                    "new": new_code
                }
            )
    return matched_diffs


def find_best_match(query, search_text):
    # TODO: It's likely that the length of the query might be slightly larger. For this reason, check the subregions of size len(n) - 10 -> n  to see which is the exact match

    query = query.strip() # Get rid of whitespace that balloons for no reason.
    query_lines = query.split("\n")
    query_length = len(query_lines)

    search_text_lines = search_text.split("\n")
    if len(search_text_lines) < query_length:
        return "Error." # done so that it returns to the user
    
    best_match = ""
    best_match_score = -1

    for start_index in range(len(search_text_lines)):
        end_index = start_index + query_length + 1
        if end_index > len(search_text_lines):
            break
        search_segment = "\n".join(search_text_lines[start_index:end_index])
        score = fuzz.ratio(query, search_segment)

        if score > best_match_score:
            best_match_score = score
            best_match = search_segment
            print("Found new best match: ", search_segment)

    return best_match.strip()

def parse_diff(diff_string):
    diff_string = diff_string.replace("...", "\n...")
    lines = diff_string.split("\n")
    changes = []
    for line in lines:
        if line.startswith("+++"):
            if len(current_filepath) > 0:
                changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
                current_filepath = ""
                current_to_remove = ""
                current_to_write = ""
            current_filepath = line[3:].strip()
            print("Processing new filepath: ", current_filepath)
        elif line.startswith("@@"):
            if len(current_to_remove) > 0 or len(current_to_write) > 0:
                changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
                current_to_remove = ""
                current_to_write = ""
        elif line.startswith("-"):
            if not(line.startswith("---")):
                current_to_remove += line[1:] + "\n"
            if previous_symbol == "+":
                # save the prevous chunk that was created
                changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
                current_to_remove = ""
                current_to_write = ""
            previous_symbol = "-"
        elif line.startswith("+"):
            current_to_write += line[1:] + "\n"
            previous_symbol = "+"
        else:
            current_to_remove += line + "\n"
            current_to_write += line + "\n"

    

    changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
    return changes


#     lines = diff_string.split("\n")
#     current_filepath = ""
#     current_to_remove= ""
#     current_to_write = ""

#     changes = []

#     previous_symbol = None
    
#     for index, line in enumerate(lines):
#         line = line.strip()
#         alt_ellipsis = "..."

#         if (alt_ellipsis in line and not(line.startswith("@@"))):
#             # need to handle this
#             before_lines = []
#             after_lines = []

#             for before_index in range(index - 1, 0 -1):
#                 if alt_ellipsis in after_index or line.startswith("@@"):
#                     break
#                 if line.startswith("-"):
#                     continue

#                 if line.startswith("+"):
#                     before_lines.insert(0, lines[before_index][1:])
#                 else:
#                     before_lines.insert(0, lines[before_index])


#             for after_index in range(index + 1, len(lines)):
#                 if alt_ellipsis in after_index or line.startswith("@@"):
#                     break
#                 if line.startswith("-"):
#                     continue

#                 if line.startswith("+"):
#                     after_lines.append(lines[after_index][1:])
#                 else:
#                     after_lines.appned(lines[after_index])

#             inline_before = line.split(alt_ellipsis)[0]
#             inline_after = line.split(alt_ellipsis)[1]

#             before_lines.append(inline_before)
#             after_lines.insert(0, inline_after)

#             before_string = "\n".join(before_lines)
#             after_string = "\n".join(after_lines)
        
#             before_string = find_best_match(before_string, file_string)
#             after_string = find_best_match(after_string, file_string)

#             middle_text = file_string.split(before_string)[1].split(after_string)[0]

#             # line
#             lines[index] = line.replace(alt_ellipsis, middle_text)
    
    # TODO: resplit the lines by newline character