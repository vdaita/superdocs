import React, { useState } from 'react'
import ReactDom from 'react-dom'
import Markdown from 'react-markdown'
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactJson from 'react-json-view';
import {Box, Group, Button, Text, Badge} from "@mantine/core";
import { VSCodeMessage } from './VSCodeMessage'
import ReactDiffViewer from 'react-diff-viewer';
import {CopyToClipboard} from 'react-copy-to-clipboard';

export default function Replacement({ content }) {
    let sendReplace = (filepath, originalText, newText) => {
        let hostContent = {
            originalCode: originalText,
            newCode: newText,
            filepath: filepath
        };
        console.log("Running sendReplace: ", hostContent);
        VSCodeMessage.postMessage({
            type: "replaceSnippet",
            content: hostContent
        });
    }

    let sendWrite = (filepath, text) => {
        let hostContent = {
            filepath: filepath,
            text: text
        };
        console.log("Running sendWrite: ", hostContent);
        VSCodeMessage.postMessage({
            type: "writeFile",
            content: hostContent
        })
    }

    return (
        <>
            <Badge
                size="xl"
                variant="gradient"
                gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
            >
                Assistant: {content["original"].length > 0 ? "Replacement" : "Write"}
            </Badge>
            <Text style={{fontWeight: "bold"}}>Filepath: {content["filepath"]}</Text>
            <ReactDiffViewer oldValue={content["original"]} newValue={content["new"]}/>
            <Button onClick={() => content["original"].length > 0 ? sendReplace(content["filepath"], content["original"], content["new"]) : sendWrite(content["filepath"], content["new"])}>Replace</Button>
        </>
    )
}