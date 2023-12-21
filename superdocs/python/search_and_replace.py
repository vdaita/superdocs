from thefuzz import fuzz

def find_best_match(query, search_text):
    query = query.strip() # Get rid of whitespace that balloons for no reason.
    query_lines = query.split("\n")
    query_length = len(query_lines)

    search_text_lines = search_text.split("\n")
    if len(search_text_lines) < query_length:
        return "Error" # done so that it returns to the user
    
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