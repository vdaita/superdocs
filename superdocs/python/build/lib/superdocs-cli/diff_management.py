from thefuzz import fuzz
import re
from .repo import find_closest_file
from unidiff import PatchSet
import json
import os
from .sweep_search_and_replace import find_best_match
# from repo import find_closest_file
# from sweep_search_and_replace import find_best_match

test_folder = "/Users/vijaydaita/Files/uiuc/rxassist/rxassist/"

test_diff = """
--- /Users/vijaydaita/Files/uiuc/rxassist/rxassist/src/app/main/page.tsx
+++ /Users/vijaydaita/Files/uiuc/rxassist/rxassist/src/app/main/page.tsx
@@ ... @@
 import React, { useState, useEffect } from 'react'; 
+import {
+  Modal,
+  ModalOverlay,
+  ModalContent,
+  ModalHeader,
+  ModalFooter,
+  ModalBody,
+  ModalCloseButton,
+  useDisclosure
+} from "@chakra-ui/react";
 import { useChat } from 'ai/react';
 import { Message } from "ai";
 
@@ ... @@
    let [quizFinished, setQuizFinished] = useState(false);
+   const { isOpen, onOpen, onClose } = useDisclosure();
 
@@ ... @@
    const determineScore = () => {
        const correct = quizData.questions.reduce((acc, q, i) => acc + (q.correctAnswer === answers[i] ? 1 : 0), 0);
        const score = (correct / quizData.questions.length) * 100;
        setScore(score);
-       // setQuizFinished(true);
+       setQuizFinished(true);
        setPaused(true);
        clearInterval(timerId);
+       onOpen(); // Open the modal when the quiz ends
    }
 
+   const retakeQuiz = () => {
+       setQuizStarted(false);
+       setQuizFinished(false);
+       setScore(null);
+       setAnswers(Array(quizData.questions.length).fill(-1));
+       setCurrentQuestionIndex(0);
+       onClose(); // Close the modal
+   }
+
    if(isLoading) {
      return (
        <Container my="12">
          <Text>Your quiz is being loaded...</Text>
        </Container>
      )
    }
    
    return (
        <Container my="12">
            <VStack spacing={6} align="stretch">
                {quizFinished
-                   ? <Box textAlign="center"><Text fontSize="xl">Your score: {score.toFixed(2)}%</Text></Box>
+                   ? <>
+                       <Modal isOpen={isOpen} onClose={onClose}>
+                           <ModalOverlay />
+                           <ModalContent>
+                               <ModalHeader>Quiz Finished</ModalHeader>
+                               <ModalCloseButton />
+                               <ModalBody>
+                                   <Text fontSize="xl">Your score: {score.toFixed(2)}%</Text>
+                               </ModalBody>
+                               <ModalFooter>
+                                   <Button colorScheme="blue" mr={3} onClick={retakeQuiz}>
+                                       Retake Quiz
+                                   </Button>
+                               </ModalFooter>
+                           </ModalContent>
+                       </Modal>
+                     </>
                    : quizStarted
                        ? <VStack spacing={4}>
                            ...
                        </VStack>
                        : <Box>
                          ...
                        </Box> 
                }
            </VStack>
        </Container>
    )
}
"""

def fuzzy_process_diff(directory, diff): # expects the contents of a fenced block.
    changes = parse_diff(diff)

    # print("All changes: ", json.dumps(changes, indent=4))
    for change_index, change in enumerate(changes):
        print("Currently processing change: ", change_index, " with values: ", json.dumps(change, indent=4))

        # Filepath:
        change["filepath"] = find_closest_file(directory, change["filepath"], threshold=30)
        full_filepath = directory + "/" + change["filepath"]
        full_filepath = full_filepath.replace("//", "/")
        file = open(full_filepath, "r+")
        file_contents = file.read()
        file_lines = file_contents.split("\n")
        
        if len(change["original"]) == 0:
            changes[change_index]["original"] = ""
            changes[change_index]["new"] = "\n".join([row[1] for row in change["new"]])
            continue

        new_original = []
        new_new = []

        # for line in change["original"]:
        #     if line[1].endswith("@@"):
        #         continue
        #     new_original.append(line[1])

        # for line in change["new"]:
        #     if line[1].endswith("@@"):
        #         continue
        #     new_new.append(line[1])
        
        # change["original"] = new_original
        # change["new"] = new_new

        print("Change: ", json.dumps(change, indent=4))

        # Process the original
        # Everything here should be original
        original_string = ("\n".join([row[1] for row in change["original"]])).strip()
        print("Found a match for: ", original_string)
        original_string = find_best_match(original_string, file_contents)
        print("         ", original_string)
        original_string = "\n".join([line for line in file_lines[original_string.start:original_string.end]])

        # Process the replacement
        replacement_string = ""

        current_string = ""
        current_type = ""
        for (row_type, row_content) in change["new"]:
            if not(current_type == row_type): # this just changed type
                print("processing current chunk: ", current_string, current_type)
                if len(current_string) > 0:
                    if current_type == "original":
                        # get the match of this segment
                        best_match = find_best_match(current_string, file_contents)
                        lines = "\n".join([line for line in file_lines[best_match.start:best_match.end]])

                        replacement_string += lines
                    else:
                        replacement_string += current_string + "\n"
                current_string = ""
            current_string += row_content + "\n"
            current_type = row_type

        if current_type == "original":
            replacement_string += current_string + "\n"
        replacement_string = replacement_string.strip()

        change["original"] = original_string
        change["new"] = replacement_string  

        changes[change_index] = change      
        
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
            full_filepath = directory + "/" + filepath
            full_filepath = full_filepath.replace("//", "/")

            print("Finalized filepath: ", full_filepath)
            file = open(full_filepath, "r")
            contents = file.read()
            file.close()

            grounded_original_code_match = find_best_match(original_code, contents)
            grounded_original_code = ["\n".join(line for line in file_lines[grounded_original_code_match.start:grounded_original_code_match.end])]

            matched_diffs.append(
                {
                    "filepath": full_filepath,
                    "old": grounded_original_code,
                    "new": new_code
                }
            )
    print("Matched diffs: ", json.dumps(matched_diffs, indent=4))
        
    return matched_diffs

def parse_diff(diff_string):
    diff_string = diff_string.replace("...", "\n...")
    lines = diff_string.split("\n")
    changes = []
    current_to_remove = []
    current_to_write = []
    current_filepath = ""

    previous_symbol = ""

    for line in lines:
        if line.startswith("+++"):
            if len(current_filepath) > 0:
                changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
                current_filepath = ""
                current_to_remove = []
                current_to_write = []
            current_filepath = line[3:].strip()
            print("Processing new filepath: ", current_filepath)
        elif line.strip().endswith("@@"):
            if len(current_to_remove) > 0 or len(current_to_write) > 0:
                changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
                current_to_remove = []
                current_to_write = []
        elif line.startswith("-"):
            if not(line.startswith("---")):
                current_to_remove.append(("original", line[1:]))
            if previous_symbol == "+":
                # save the prevous chunk that was created
                changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
                current_to_remove = []
                current_to_write = []
            previous_symbol = "-"
        elif line.startswith("+"):
            current_to_write.append(("new", line[1:]))
            previous_symbol = "+"
        else:
            current_to_remove.append(("original", line))
            current_to_write.append(("original", line))


    changes.append({
                    "filepath": current_filepath,
                    "original": current_to_remove,
                    "new": current_to_write
                })
    return changes


if __name__ == "__main__":
    print("Testing diff managment")
    print(fuzzy_process_diff(test_folder, test_diff))