import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Text, TextInput, Textarea, Stack, Tabs, Card, Badge, Loader, Radio, Group, Box, Checkbox, Overlay } from '@mantine/core';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import OpenAI from 'openai';
import { notifications } from '@mantine/notifications';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { usePostHog } from 'posthog-js/react'
import { CopyBlock } from 'react-code-blocks';
import { AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT } from './lib/prompts';
import { getFixedSearchReplace, parseDiff, SearchReplaceChange } from './lib/diff';
import { unifiedDiff } from 'difflib';


type Generation = {
  planCompleted: boolean;
  changesCompleted: boolean;
  changes: {
    filepath: string;
    instruction: string;
    location: string;
    search_block: string;
    replace_block: string;
  }[];
  rank: number;
  progress: string;
  plan: string;
  summary: string;
};

type Plan = {
  message: string
  changes: Change[] 
}

type EditInstruction = {
  instruction: string
  filepath: string
  changesCompleted: boolean
  changeUpdate?: string
  changes?: Change[]
}

type Change = {
  filepath: string
  searchBlock: string
  replaceBlock: string
}

type NewFile = {
  filepath: string,
  code: string,
}

type Snippet = {
  filepath: string
  code: string
  language: string
}

export default function App(){
  let [query, setQuery] = useState("");
  let [snippets, setSnippets] = useState<Snippet[]>([]);

  let [openaiApiKey, setOpenAIApiKey] = useState("");
  
  let [plans, setPlans] = useState<Plan[]>([]);

  let [error, setError] = useState<string | undefined>();

  let [whichContext, setWhichContext] = useState<string>("");

  let posthogIdentifiedUserRef = useRef<boolean>(false);

  let [candidateQueries, setCandidateQueries] = useState([]);

  let [loading, setLoading] = useState<boolean>(false);
  let [abortController, setAbortController] = useState<AbortController | undefined>();
  const posthog = usePostHog();

  let [miscText, setMiscText] = useState<string>("");

  useEffect(() => {
    console.log("Running useEffect");
    VSCodeMessage.onMessage((message) => {
      message = message.data;
      console.log("Received message: ", message);
      if(message.type === "context") {
        if(message.content.telemetryAllowed) {
          posthog.opt_in_capturing();
        } else {
          posthog.opt_out_capturing();
        }
        
        if(message.content.openaiApiKey) {
          setOpenAIApiKey(message.content.openaiApiKey);
        }
      } else if (message.type === "snippet") {
        console.log("Received snippet: ", message)
        setSnippets((prevSnippets) => {
          console.log("Considering adding a new snippet to this list of snippets: ", prevSnippets);
          let alreadyExists = false;
          for(var i = 0; i < prevSnippets.length; i++){
            // console.log("Comparing: ", {
            //   currFilepath: prevSnippets[i].filepath,
            //   currCode: prevSnippets[i].code,
            //   newFilepath: message.content.filepath,
            //   newCode: message.content.code,
            //   returning: prevSnippets[i].filepath === message.content.filepath && prevSnippets[i].code === message.content.code
            // });
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
        if(message.content.whichContext === 'currentonly') {
          processRequestWithSingleFile(message.content.snippets[0], message.content.query);
        } else {
          processRequestWithSnippets(message.content.snippets, message.content.query);
        }
      }
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // TODO: listen for a change in the authentication state
  }, []);

  // TOOD: make sure that you allow the person to reclick for anonymous authentication again.
  let processRequest = async () => {
    await processRequestWithSnippets(snippets, query);
  }

  let processRequestWithSingleFile = async(snippet: Snippet, query: string) => {
    setLoading(true);
    try {
      let response = await fetch("https://vdaita--superdocs-server-model-generate.modal.run", {
        body: JSON.stringify({
          "file_contents": snippet.code,
          "edit_instruction": query
        }),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
  
      if(!response.body) {
        setError("Error with loading response.body");
        return;
      }
  
      let text = await response.text();
      console.log("Got text from the server: ", text);
      setMiscText(text);
      writeMergeFile(snippet.filepath, snippet.code, text);

    } catch (e) {
      console.error("Error caught: ", e);
    }

    setLoading(false);
  }

  let processRequestWithSnippets = async (snippets: Snippet[], query: string) => {
    posthog?.capture("process_snippets");
    setError("");

    console.log("Current environment: ", process.env.NODE_ENV);
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 5000);

    try {
      console.log("Sending snippets and query: ", snippets, query);

      const openai = new OpenAI({
        apiKey: openaiApiKey,
        dangerouslyAllowBrowser: true
      });

      let fileContextStr = "";
      snippets.forEach((snippet) => {
          fileContextStr += `[${snippet.filepath}]\n \`\`\`\n${snippet.code}\n\`\`\`\n`
      });

      let completion = await openai.chat.completions.create({
        messages: [{
          "role": "system",
          "content": AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT
        }, {
          "role": "user",
          "content": `# File context:\n${fileContextStr}\n# Instruction\n${query}`
        }],
        model: "gpt-4o",
        stream: true
      });

      let responseText = "";

      for await(const chunk of completion) {
        let chunkText = chunk.choices[0].delta.content;
        if(chunkText) {
          responseText += chunkText;
          setPlans([
            {
              "message": responseText,
              "changes": []
            }
          ]);
        }
      }

      let fpSet = new Set<string>();
      snippets.forEach((snippet) => { fpSet.add(snippet.filepath); });
      let filepaths = Array.from(fpSet);

      let unifiedSnippets: Snippet[] = [];
      let files = new Map();
      filepaths.forEach((filepath: string) => {
          let codeChunks: string[] = [];
          let lang: string = "";            
          snippets.forEach((snippet) => {
              if(snippet.filepath === filepath) {
                  codeChunks.push(snippet.code);
                  lang = snippet.language;
              }
          });
          unifiedSnippets.push({
              filepath: filepath,
              code: codeChunks.join("\n----\n"),
              language: lang
          });
          files.set(filepath, codeChunks.join("\n----\n"));
      });


      let fixedSearchReplaces = getFixedSearchReplace(files, responseText);
      let changes: Change[] = [];
      fixedSearchReplaces.forEach((fsr) => {
          if(fsr.searchBlock.trim().length > 0 && fsr.replaceBlock.trim().length > 0){ // empty SRs are leaking
              changes?.push({
                  filepath: fsr.filepath,
                  searchBlock: fsr.searchBlock,
                  replaceBlock: fsr.replaceBlock
              });
          }
      });

      setPlans([
        {
          "message": responseText,
          "changes": changes
        }
      ]);

    } catch (e) {
      console.error("Error: ", e);
      setError("There was an error.");
    }
    console.log("Reached the end of the function.");
    setLoading(false);
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

  let writeMergeFile = (filepath: string, oldContents: string, newContents: string) => {
    let generatedDiff = unifiedDiff(oldContents.split("\n"), newContents.split("\n"), {}).join("\n");
    let searchReplaceChanges = parseDiff(generatedDiff);
    console.log("search replace changes: ", searchReplaceChanges);
    let contentsWithMerge = oldContents;
    searchReplaceChanges.forEach((snippet: SearchReplaceChange) => {
      contentsWithMerge = contentsWithMerge.replace(
        snippet.searchBlock,
        `<<<<<<< SEARCH
${snippet.searchBlock}
=======
${snippet.replaceBlock}
>>>>>>> REPLACE
        `
      );
    });

    

    VSCodeMessage.postMessage({
      type: "writeFile",
      content: {
        filepath: filepath,
        code: contentsWithMerge
      }
    })
  }

  let getCurrentFileAndProcessRequest = () => {
    VSCodeMessage.postMessage({
      type: "getCurrentOpenFile",
      content: {
        runProcessRequest: true,
        query: query
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
    posthog?.capture("send_change");

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
    if(whichContext === "addall") {
      addWorkspaceAndProcessRequest();
    } else if (whichContext === "currentonly") {
      getCurrentFileAndProcessRequest();
    } else {
      processRequest();
    }
  }

  if(openaiApiKey.length <= 0){
    return (
      <Text m={4}>There needs to be an OpenAI key loaded in settings. You may want to refresh the window: Ctrl-Shift-P → Reload Window.</Text>
    )
  }

  return (
    <Stack p={2} mt={6}>
      <Textarea onChange={(e) => setQuery(e.target.value)} size="lg" value={query} placeholder={"Query"}>
      </Textarea>

      {loading && <Box>
        <Text style={{fontSize: 10}}>Need to refresh? Refresh the Webview by using Ctrl-Shift-P → Reload Webviews.</Text>
        <Loader/>
      </Box>}
      
      {(!(whichContext === 'snippets') && snippets.length > 0) && <Button variant='outline' onClick={() => setSnippets([])}>Clear Snippets</Button> }
      {!(whichContext === 'snippets') && <Container m="sm" opacity="80">
        {snippets.map((item, index) => (
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <details>
              <summary>{item.filepath}</summary>
              <EnhancedMarkdown height={100} message={`${item.filepath}\n\n` + "```" + `${item.language}\n${item.code}` + "\n```"}/>
            </details>
            <Button onClick={() => deleteSnippet(index)}>
              Delete Snippet
            </Button>
          </Card>
        ))}
        {/* <Overlay opacity={0.6}/> */}
      </Container>}

      {(whichContext === 'addall') && <Text style={{fontSize: 10}}>Can't add snippets and everything from tabs at the same time.</Text>}


      <Radio.Group
        value={whichContext}
        onChange={setWhichContext}
        name="whichContext"
        withAsterisk
      >
        <Radio value="addall" label="Add All Open Files in Workspace"/>
        <Radio value="currentonly" label="Current File Only (fast model)"/>
        <Radio value="snippets" label="Only Selected Snippets"/>
      </Radio.Group>

      {/* <Radio
        label="Context Type"
        description=""
        onChange={(e) => setWhichContext(e.target.value)}
      >
        <Group mt="xs">
          <Radio value="addall" label="Add All Open Files in Workspace"/>
          <Radio value="currentonly" label="Current File Only (fast model)"/>
          <Radio value="snippets" label="Only Selected Snippets"/>
        </Group>
      </Radio> */}

      <Button onClick={() => processRequestWithContext()}>Process request</Button>
      {/* <Button onClick={() => stopRequest()} variant="outline">Stop Request if available</Button> */}

      {error && <Box color="red">
        {error}
      </Box>}

      <Text>{miscText}</Text>

      <Tabs value={"0"}>
        <Tabs.List>
          {plans.map((item, index) => (
            <Tabs.Tab value={index.toString()}>
              Plan {index}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {plans.map((item, index) => (
          <Box>
            {/* {JSON.stringify(item)} */}
            {item['message'] && <EnhancedMarkdown message={item['message']} height={60}/>}
            {item["changes"] && <>
            {
              item["changes"].map((editItem, editIndex) => (
                <Card>
                  <Text style={{fontWeight: "bold"}}>{editItem.filepath}</Text>
                  <Box m="sm" bg="red">
                    Replace:
                    <CopyBlock
                      text={editItem.searchBlock}
                      language={getMatchingLanguageFromFilepath(editItem.filepath)}
                      wrapLongLines
                    />
                  </Box>
                  <Box m="sm" bg="green">
                    with: 
                    <CopyBlock
                      text={editItem.replaceBlock}
                      language={getMatchingLanguageFromFilepath(editItem.filepath)}
                      wrapLongLines
                    />
                  </Box>
  
                  <Button onClick={() => sendChange(editItem.filepath, editItem.searchBlock, editItem.replaceBlock)}>Accept change</Button>
                </Card>
              ))
            }
            </>}
          </Box>
        ))}
      </Tabs>
    </Stack>
  );
}