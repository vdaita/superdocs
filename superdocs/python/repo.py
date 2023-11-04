from pathlib import Path
import glob
import os
import pathspec

def _get_gitignore_rules(directory):
    gitignore_rules = []

    for filepath in glob.iglob(f'{directory}/**/*.gitignore'):
        full_gitignore_filepath = os.path.join(directory, filepath)
        gitignore_subdirectory = filepath.replace(".gitignore", "")
        gitignore_file = open(full_gitignore_filepath, "r")
        lines = gitignore_file.readlines()
        for line in lines:
            if len(line) > 0:
                gitignore_rules.append(os.path.join(gitignore_subdirectory, line))

    return gitignore_rules

def get_valid_files(directory):
    gitignore_rules = _get_gitignore_rules(directory)
    spec = pathspec.GitIgnoreSpec.from_lines(gitignore_rules)
    matches = spec.match_files(directory)
    return matches