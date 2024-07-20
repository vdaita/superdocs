import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Text, TextInput, Textarea, Stack, Tabs, Card, Badge, Loader, Box, Checkbox, Overlay } from '@mantine/core';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import OpenAI from 'openai';
import { notifications } from '@mantine/notifications';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { usePostHog } from 'posthog-js/react'
import { CopyBlock } from 'react-code-blocks';
import { AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT } from './lib/prompts';
import { getFixedSearchReplace } from './lib/diff';


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

  let [addEverythingFromWorkspace, setAddEverythingFromWorkspace] = useState(false);

  let [predictCurrentObjective, setPredictCurrentObjective] = useState(false);
  let predictCurrentObjectiveRef = useRef<boolean>(false);
  predictCurrentObjectiveRef.current = predictCurrentObjective;
  let lastPredictionRequestSent = useRef<number>(0);

  let posthogIdentifiedUserRef = useRef<boolean>(false);

  let [candidateQueries, setCandidateQueries] = useState([]);

  let [loading, setLoading] = useState<boolean>(false);
  let [abortController, setAbortController] = useState<AbortController | undefined>();
  const posthog = usePostHog();

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
      } else if (message.type == "processRequest") {
        processRequestWithSnippets(message.content.snippets, message.content.query);
      } else if (message.type == "recentChanges") {
        console.log("Will send predict current objective request? : ", predictCurrentObjectiveRef.current, " last prediction sent: ", lastPredictionRequestSent.current, " current time: ", Date.now());
        if(predictCurrentObjectiveRef.current && (Date.now() - 5000) > lastPredictionRequestSent.current){
          lastPredictionRequestSent.current = Date.now();
          processRecentChangesRequest(message.content["changes"], message.content["workspaceFiles"]);
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

  let stopRequest = async () => {
    if(abortController){
      abortController.abort();
      notifications.show({
        message: "Cancelled the request."
      });
    } else {
      notifications.show({
        message: "No request to cancel"
      })
    }
  }

  let processRecentChangesRequest = async (changes: string, workspaceFiles: string) => {
    let url = (process.env.NODE_ENV === "development") ? "http://localhost:3001/api/recommend_prompts" : "https://superdocs-sand.vercel.app/api/recommend_prompts/";
    console.log("Running processRecentChangesRequest function");
    try {
      if (changes.length < 10) {
        console.log("Skipping - less that 30 characters detected.");
        return;
      }
      
      console.log("Sending recent changes: ", changes);
      let response = await fetch(url, {
        body: JSON.stringify({
          changes: changes,
          workspaceFiles: workspaceFiles
        }),
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if(response.ok) {
        console.log("processRecentChangesRequest: got OK response from server");
        let json = await response.json();
        console.log("Recent changes request json: ", json);
        setCandidateQueries(json['possibleQueries']);
      } else {
        console.error("Error with recent changes request: ", response);
      }
    } catch (e) {
      console.log("Error when processing recent changes request");
      console.error(e);
    }
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

  let setPredictAndAllWorkspace = (newValue: boolean, checkbox: string) => { // If predict is true, then add all open tabs is true. If add all open tabs is false, then predict is true
      if(checkbox === 'predict' && newValue){
        setAddEverythingFromWorkspace(true);
        setPredictCurrentObjective(true);
        return;
      }

      if(checkbox == 'addAll' && !newValue){
        setAddEverythingFromWorkspace(false);
        setPredictCurrentObjective(false);
        return;
      }

      if(checkbox == 'addAll'){
        setAddEverythingFromWorkspace(newValue);
      }

      if(checkbox == 'predict') {
        setPredictCurrentObjective(newValue);
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

      {candidateQueries.map((item, index) => (
        <Card shadow="sm" padding="xs" radius="md" withBorder onClick={() => setQuery(item)}>
          <Text size="sm">{item}</Text>
        </Card>
      ))}

      {loading && <Box>
        <Text style={{fontSize: 10}}>Need to refresh? Refresh the Webview by using Ctrl-Shift-P → Reload Webviews.</Text>
        <Loader/>
      </Box>}
      
      {(!addEverythingFromWorkspace && snippets.length > 0) && <Button variant='outline' onClick={() => setSnippets([])}>Clear Snippets</Button> }
      {!addEverythingFromWorkspace && <Container m="sm" opacity="80">
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

      {addEverythingFromWorkspace && <Text style={{fontSize: 10}}>Can't add snippets and everything from tabs at the same time.</Text>}

      {/* <Checkbox label="Check your changes to predict your current objective" checked={predictCurrentObjective} onChange={(e) => setPredictAndAllWorkspace(e.currentTarget.checked, 'predict')}></Checkbox> */}
      <Checkbox label="Add all open tabs" checked={addEverythingFromWorkspace} onChange={(e) => setPredictAndAllWorkspace(e.currentTarget.checked, 'addAll')}></Checkbox>
      <Button onClick={() => addEverythingFromWorkspace ? addWorkspaceAndProcessRequest() : processRequest()}>Process request</Button>
      {/* <Button onClick={() => stopRequest()} variant="outline">Stop Request if available</Button> */}

      {error && <Box color="red">
        {error}
      </Box>}

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