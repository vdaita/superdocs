import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Text, TextInput, Textarea, Stack, Tabs, Card, Badge, Loader, Radio, Group, Box, Checkbox, Overlay } from '@mantine/core';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { CopyBlock } from 'react-code-blocks';
import axios from 'axios';

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

  // let [openaiApiKey, setOpenAIApiKey] = useState("");
  let [serverUrl, setServerUrl] = useState("https://127.0.0.1:8000");

  let [plans, setPlans] = useState<Plan[]>([]);

  let [error, setError] = useState<string | undefined>();

  let [whichContext, setWhichContext] = useState<string>("");

  let [candidateQueries, setCandidateQueries] = useState([]);

  let [loading, setLoading] = useState<boolean>(false);
  let [abortController, setAbortController] = useState<AbortController | undefined>();

  let [miscText, setMiscText] = useState<string>("");

  useEffect(() => {
    console.log("Running useEffect");
    VSCodeMessage.onMessage((message) => {
      message = message.data;
      console.log("Received message: ", message);
      if(message.type === "context") {
        if(message.content.serverUrl) {
          
          // setServerUrl(message.content.serverUrl);
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
        }
      }
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // TODO: listen for a change in the authentication state
  }, []);

  let processRequestWithSingleFile = async(snippet: Snippet, query: string) => {
    setLoading(true);
    setMiscText("");
    try {
      console.log("Server url being used: ", serverUrl);
      const url = 'http://0.0.0.0:8000/edit_request';

      const data = {
          "file_content": snippet.code,
          "query": query
      };

      const options = {
          method: 'POST',
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
      };

      let responseFetch = await fetch(url, options)
      let response = await responseFetch.json();
  
      // const text = response.data;
      // console.log("Got text from the server: ", text);
      // const jsonText = JSON.parse(text);

      let formattedText = `Tokens generated: ${response['tokens_generated']}\nTime: ${response['time']}\nTokens per second: ${response['tokens_generated']/response['time']}\n\`\`\`\n${response['text']}\n\`\`\``;

      setMiscText(formattedText);
      // writeMergeFile(snippet.filepath, snippet.code, jsonText);

      VSCodeMessage.postMessage({
        type: "writeFile",
        content: {
          filepath: snippet.filepath,
          code: response["text"]
        }
      });
  
    } catch (e) {
      console.error("Error caught: ", e);
    }
  
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
    if (whichContext === "currentonly") {
      getCurrentFileAndProcessRequest();
    }
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
        name="currentonly"
        withAsterisk
      >
        <Radio value="currentonly" label="Current File Only (fast model)"/>
      </Radio.Group>

      <Button onClick={() => processRequestWithContext()}>Process request</Button>

      {error && <Box color="red">
        {error}
      </Box>}

      <EnhancedMarkdown height={100} message={miscText}></EnhancedMarkdown>

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