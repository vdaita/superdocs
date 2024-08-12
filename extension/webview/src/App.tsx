import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Text, TextInput, Textarea, Stack, Tabs, Card, Badge, Loader, Radio, Group, Box, Checkbox, Overlay } from '@mantine/core';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { CopyBlock } from 'react-code-blocks';
import axios from 'axios';
import { createTwoFilesPatch } from 'diff';
import { searchReplaceFormatSingleFile } from './lib/diff';
import Groq from 'groq-sdk';
import levenshtein from 'js-levenshtein';

type Plan = {
  message: string
  changes: Change[] 
}

type Change = {
  filepath: string
  searchBlock: string
  replaceBlock: string
}

type Snippet = {
  filepath: string
  code: string
  language: string
}

export default function App(){
  let [query, setQuery] = useState("");
  let [snippets, setSnippets] = useState<Snippet[]>([]);
  let [fileSnippets, setFileSnippets] = useState<Snippet[]>([]);

  // let [openaiApiKey, setOpenAIApiKey] = useState("");
  let [groqApiKey, setGroqApiKey] = useState("");

  let [plans, setPlans] = useState<Plan[]>([]);

  let [error, setError] = useState<string | undefined>();

  let [whichContext, setWhichContext] = useState<string>("");

  let [candidateQueries, setCandidateQueries] = useState([]);

  let [loading, setLoading] = useState<boolean>(false);
  let loadingRef = useRef<boolean>(false);

  let [abortController, setAbortController] = useState<AbortController | undefined>();

  let [miscText, setMiscText] = useState<string>("");

  useEffect(() => {
    console.log("Running useEffect");
    VSCodeMessage.onMessage((message) => {
      message = message.data;
      console.log("Received message: ", message);
      if(message.type === "context") {
        if(message.content.groqApiKey) {
          setGroqApiKey(message.content.groqApiKey);
        }
      } else if (message.type === "snippet") {
        console.log("Received snippet: ", message)
        setSnippets((prevSnippets) => {
          console.log("Considering adding a new snippet to this list of snippets: ", prevSnippets);
          let alreadyExists = false;
          for(var i = 0; i < prevSnippets.length; i++){
            if(prevSnippets[i].filepath === message.content.filepath && prevSnippets[i].code === message.content.code){
              alreadyExists = true;
              break;
            }
          }
          
          if(alreadyExists){
            return [...prevSnippets];
          } else {
            return [...prevSnippets, {
              code: message.content.code,
              filepath: message.content.filepath,
              language: message.content.language
            }]
          }
        });
      } else if (message.type == "processRequest") { // going to be the same for single file or multiple files
        processRequestWithAllFiles(message.content.snippets, message.content.query, message.content.apiKey);
      }
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // TODO: listen for a change in the authentication state
  }, []);

  function parseSnippets(text: string) {
      const linesArray = text.split('\n');
      const snippetList: Snippet[] = [];
      let activeSnippet: Snippet | undefined | null = null;

      linesArray.forEach(currentLine => {
          const cleanedLine = currentLine.trim();

          // Detect the start of a new snippet by checking if the line ends with a file extension
          if (cleanedLine.includes('.') && !cleanedLine.startsWith('```')) {
              if (activeSnippet) {
                  snippetList.push(activeSnippet);
              }
              activeSnippet = {
                  filepath: cleanedLine,
                  code: '',
                  language: ''
              };
          } else if (cleanedLine.startsWith('```') && activeSnippet) {
              if (!activeSnippet.language) {
                  // Set the language (everything after the first backticks)
                  activeSnippet.language = cleanedLine.replace(/```/g, '').trim();
              } else {
                  // End of code block
                  snippetList.push(activeSnippet);
                  activeSnippet = null;
              }
          } else if (activeSnippet && activeSnippet.language) {
              // Add line to code block
              activeSnippet.code += currentLine + '\n';
          }
      });

      // Push the last snippet if it wasn't added yet
      if (activeSnippet) {
          snippetList.push(activeSnippet);
      }

      return snippetList.map(snippet => ({
          ...snippet,
          code: snippet.code.trim() // Trim extra newlines from code
      }));
  }

  let processRequestWithAllFiles = async(snippets: Snippet[], query: string, groqApiKey: string) => { // Make sure that the currently opened file is first.
    console.log("Loading ref value: ", loadingRef.current);

    if(loadingRef.current){
      console.log("Already processing request, doing nothing");
      return;
    }

    console.log("File snippets: ", snippets);
    
    setLoading(true);
    loadingRef.current = true;

    setMiscText("");
    console.log("Processing request");

    let filesText = ""; // Estimate that each token is 4 chars long, then max 48 chars
    if(snippets.length > 0){
      filesText += `Currently open file: ${snippets[0].filepath}\n\n`;
    }
    snippets.forEach((snippet) => {
      let potentialFile = `${snippet.filepath}\n\`\`\`\n${snippet.code}\n\`\`\``;
      if(filesText.length + potentialFile.length <= 20000) {
        filesText += "\n" + potentialFile;
      }
    });

    setFileSnippets(snippets);

    console.log("File string: ", filesText);

    try {

      console.log("Groq api key: ", groqApiKey);

      let groqClient = new Groq({
        apiKey: groqApiKey,
        dangerouslyAllowBrowser: true
      });
      const chatCompletion = await groqClient.chat.completions.create({
        messages: [{
          "role": "system",
          "content": `Act as an expert software developer.
Take requests for changes to the supplied code. Fulfill the requests to the best of your ability. The user cannot chat with you beyond their request, so don't ask for confirmation or anything.

Always reply to the user in the same language they are using.

Once you understand the request you MUST:
1. Determine if any code changes are needed.
2. Explain any needed changes.
3. If changes are needed, output a copy of each file that needs changes.

To suggest changes to a file you MUST return the entire content of the updated file.
You MUST use this *file listing* format:

path/to/filename.js
\`\`\`javascript
// entire file content ...
// ... goes in between
\`\`\`
# Files: \n ${filesText}


Every *file listing* MUST use this format:
- First line: the filename with any originally provided path
- Second line: opening \`\`\`language
- ... entire content of the file ...
- Final line: closing \`\`\`

To suggest changes to a file you MUST return a *file listing* that contains the entire content of the file.
*NEVER* skip, omit or elide content from a *file listing* using "..." or by adding comments like "... rest of code..."!
Create a new file you MUST return a *file listing* which includes an appropriate filename, including any appropriate path.

`
        }, {
          "role": "user",
          "content": `# Change request: ${query}`
        }],
        model: "llama3-8b-8192"
      });

      const groqResponse = chatCompletion.choices[0].message.content;
      setMiscText(groqResponse!);

      const generatedFiles = parseSnippets(groqResponse!);

      console.log("Generated files: ", generatedFiles);

      

      // TODO: extract the code blocks and then iterate through each of them.
      generatedFiles.forEach((genSnippet: Snippet) => {
        let closestMatchFilepath = genSnippet.filepath;
        let original = "";
        let matchValue = 0.8;
        snippets.forEach((snippet) => {
          let levSim = 1 - (levenshtein(snippet.filepath, genSnippet.filepath) / Math.max(snippet.filepath.length, genSnippet.filepath.length));
          if(levSim > matchValue) {
            closestMatchFilepath = snippet.filepath;
            original = snippet.code;
            matchValue = levSim;
          }
        });

      });
    } catch (e) {
      console.error("Error caught: ", e);
    }
  
    setLoading(false);
    loadingRef.current = false;
  }

  let getMatchingLanguageFromFilepath = (filepath: string) => {
    snippets.forEach((snippet) => {
      if(snippet.filepath == filepath) {
        return snippet.language;
      }
    });
    return "text";
  }

  let addWorkspaceAndProcessRequest = () => {
    VSCodeMessage.postMessage({
      type: "getWorkspaceData",
      content: {
        runProcessRequest: true,
        query: query
      }
    });
  }

  let getCurrentFileAndProcessRequest = () => {

    let newQuery = query;
    if(snippets.length > 0){
      newQuery += "\n User chosen snippets";
      snippets.forEach((snippet: Snippet) => {
        newQuery += `From snippet ${snippet.filepath}, \n \`\`\`\n ${snippet.code} \n\`\`\` \n`
      });
    }


    VSCodeMessage.postMessage({
      type: "getWorkspaceData",
      content: {
        runProcessRequest: true,
        query: newQuery,
        apiKey: groqApiKey
      }
    })
  }

  let deleteSnippet = (index: number) => {
    console.log("Trying to delete snippet at index: ", index);
    setSnippets((prevSnippets: Snippet[]) => {
      let newList = prevSnippets.splice(index, 1);
      console.log("Delete snippet - spliced list: ", newList);
      return newList;
    });
  }
  
  let sendChange = (filepath: string, search_block: string, replace_block: string) => {
    VSCodeMessage.postMessage({
      type: "replaceSnippet",
      content: {
        originalCode: search_block,
        newCode: replace_block,
        filepath: filepath
      }
    })
  }

  let processRequestWithContext = () => {
    // if (whichContext === "currentonly") {
    getCurrentFileAndProcessRequest();
    // }
  }

  return (
    <Stack p={2} mt={6}>
      <Textarea onChange={(e) => setQuery(e.target.value)} size="lg" value={query} placeholder={"Query"}>
      </Textarea>

      {loading && <Box>
        <Text style={{fontSize: 10}}>Up to 40k characters are sent to the server. Need to refresh? Refresh the Webview by using Ctrl-Shift-P → Reload Webviews.</Text>
        <Loader/>
      </Box>}
      
      {(snippets.length > 0) && <Button variant='outline' onClick={() => setSnippets([])}>Clear Snippets</Button> }
      {<Container m="sm" opacity="80">
        {snippets.map((item, index) => (
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <details>
              <summary>{item.filepath}</summary>
              <EnhancedMarkdown height={100} message={`${item.filepath}\n\n` + "```" + `${item.language}\n${item.code}` + "\n```"} fileSnippets={[]}/>
            </details>
            <Button onClick={() => deleteSnippet(index)}>
              Delete Snippet
            </Button>
          </Card>
        ))}
        {/* <Overlay opacity={0.6}/> */}
      </Container>}

      {(whichContext === 'currentonly') && <Text style={{fontSize: 10}}>Can't add snippets and everything from tabs at the same time.</Text>}


      {/* <Radio.Group
        value={whichContext}
        onChange={setWhichContext}
        name="currentonly"
        withAsterisk
      >
        <Radio value="currentonly" label="Current File Only (fast model)"/>
      </Radio.Group> */}

      <Button onClick={() => processRequestWithContext()}>Process request</Button>

      {error && <Box color="red">
        {error}
      </Box>}

      <EnhancedMarkdown height={100} message={miscText} fileSnippets={fileSnippets}></EnhancedMarkdown>
    </Stack>
  );
}