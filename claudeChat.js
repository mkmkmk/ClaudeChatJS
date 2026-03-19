const MODEL_ID = "claude-sonnet-4-5-20250929"
const WELCOME_MSG = 'Cześć! Jestem Claude. W czym mogę pomóc?';
const WORKER_URL = 'https://ant1.mariusz-krej.workers.dev';
const NO_HIGHLIGHT = 'pre code:not(.language-plotly-js):not(.language-plotly):not(.language-canvas):not(.language-svg)';

// const emojis = ["🙂", "😀", "😄", "😊", "😂", "🤣", "😅",  "😢", "😙", "😘", "😜", "😟", "🙁", "🤔", "🤨", "👍", "👎",  "🚀", "🎯", "🎉", "🌶️", '✨', "✅", "❌", "⚠️", "💡"];
const emojis = ['👍', '👎', "👏", "🙏", '😊', '😂', "😮", '🤔', "😱", '👏', '🎉', '🔥', "🎯", '✨', '💡', '🚀'];

const PASSWORD = localStorage.getItem('chat_password');
if (!PASSWORD) {
    const pwd = prompt('Enter password to access chat:');
    if (!pwd) {
        alert('Password required!');
        throw new Error('No password provided');
    }
    localStorage.setItem('chat_password', pwd);
    location.reload();
}


function logout() {
    if (confirm('Logout and clear password?')) {
        localStorage.removeItem('chat_password');
        location.reload();
    }
}


const chatHistory = [];
let isProcessing = false;
let lastCodeOutput = null;

// Auto-resize textarea
const input = document.getElementById('input');
input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});


function updateMessage(messageId, content) {
    const messageDiv = document.getElementById(messageId);
    if (!messageDiv) return;

    const contentDiv = messageDiv.querySelector('.message-content');
    if (!contentDiv) return;

    const html = marked.parse(content);
    contentDiv.innerHTML = DOMPurify.sanitize(html);

    // Renderuj LaTeX
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(contentDiv, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\$', right: '\\$', display: false },
                { left: '$', right: '$', display: false }
            ],
            throwOnError: false,
            strict: false
        });
    }

    contentDiv.querySelectorAll(NO_HIGHLIGHT).forEach((block) => {
        hljs.highlightElement(block);
    });

    // Auto-scroll
    const chat = document.getElementById('chat');
    chat.scrollTop = chat.scrollHeight;
}

async function sendMessage(silentMode = false, customMessage = null) {
    console.log('sendMessage called:', { silentMode, customMessage });

    if (isProcessing) return;

    const message = customMessage || input.value.trim();
    if (!message) return;

    const sendBtn = document.getElementById('send');

    if (!silentMode) {
        addMessage('user', message);
        input.value = '';
        input.style.height = 'auto';
    }

    chatHistory.push({ role: 'user', content: message });

    sendBtn.disabled = true;
    isProcessing = true;

    // Show loading
    const loadingId = addMessage('assistant', '💭 Thinking', true);

    try {
        const response = await fetch(WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('chat_password')}`
            },
            body: JSON.stringify({
                model: MODEL_ID,
                max_tokens: 4000,
                system: SYSTEM_PROMPT,
                messages: chatHistory
            })
        });

        if (response.status === 401) {
            localStorage.removeItem('chat_password');
            alert('Invalid password! Please refresh and try again.');
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        document.getElementById(loadingId).remove();

        // Streaming
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        let messageId = null;
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.type === 'content_block_delta') {
                            const text = parsed.delta?.text || '';
                            assistantMessage += text;

                            if (!messageId) {
                                messageId = addMessage('assistant', assistantMessage);
                            } else {
                                updateMessage(messageId, assistantMessage);
                            }
                        }
                    } catch (e) {
                        console.warn('SSE parse error:', e, 'Line:', line);
                    }
                }
            }
        }

        chatHistory.push({ role: 'assistant', content: assistantMessage });

        const codeBlocks = assistantMessage.match(/```(plotly(-js)?|canvas|svg|js)\n[\s\S]*?```/g);

        if (codeBlocks && codeBlocks.length > 0) {
            const contentDiv = document.getElementById(messageId).querySelector('.message-content');
            renderPlotlyInDOM(contentDiv);
            renderCanvasInDOM(contentDiv);
            renderSVGInDOM(contentDiv);
            renderJSInDOM(contentDiv);

            if (typeof renderMathInElement !== 'undefined') {
                renderMathInElement(contentDiv, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '\\$', right: '\\$', display: false },
                        { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                });
            }
            contentDiv.querySelectorAll('pre code:not(.language-plotly-js)').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

    } catch (error) {
        document.getElementById(loadingId)?.remove();
        addMessage('assistant', '❌ Error: ' + error.message);
        console.error('Error:', error);

    } finally {
        sendBtn.disabled = false;
        isProcessing = false;
        input.focus();

        if (/*!silentMode &&*/ chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
            // const lastMsg = chatHistory[chatHistory.length - 1];
            if (lastCodeOutput !== null) {
                setTimeout(() => {
                    const output = lastCodeOutput.length > 1000
                        ? lastCodeOutput.substring(0, 1000) + '\n... (truncated)'
                        : lastCodeOutput;
                    lastCodeOutput = null;
                    sendMessage(true, '[Auto-reply]\n' + output + "\n[Auto-reply end, avoid auto reply loops!]\n");
                }, 500);
            }
        }

    }
}


function renderPlotlyInDOM(contentDiv) {
    const jsBlocks = contentDiv.querySelectorAll('pre code.language-plotly-js');

    jsBlocks.forEach(codeBlock => {
        const code = codeBlock.textContent;
        const preElement = codeBlock.parentElement;
        const plotId = 'plot-' + Date.now() + Math.random();
        const plotDiv = document.createElement('div');
        plotDiv.id = plotId;
        plotDiv.style.width = '100%';
        plotDiv.style.height = '380px';
        preElement.replaceWith(plotDiv);

        try {
            console.log('=== Plotly Code ===');
            console.log(code);
            const plotConfig = new Function(code)();
            Plotly.newPlot(plotId, plotConfig.data, plotConfig.layout || {}, {
                displayModeBar: false,
                staticPlot: true
            });

        } catch (err) {
            console.error('Plotly error:', err);
            plotDiv.innerHTML = `<div style="color:red;">Error: ${err.message}</div>`;
        }
    });

    const jsonBlocks = contentDiv.querySelectorAll('pre code.language-plotly');
    jsonBlocks.forEach(codeBlock => {
        const code = codeBlock.textContent;
        const preElement = codeBlock.parentElement;
        const plotId = 'plot-' + Date.now() + Math.random();
        const plotDiv = document.createElement('div');
        plotDiv.id = plotId;
        plotDiv.style.width = '100%';
        plotDiv.style.height = '380px';
        preElement.replaceWith(plotDiv);

        try {
            console.log('=== Plotly JSON ===');
            console.log(code);
            const plotConfig = JSON.parse(code);
            Plotly.newPlot(plotId, plotConfig.data, plotConfig.layout || {}, {
                displayModeBar: false,
                staticPlot: true
            });
        } catch (err) {
            console.error('Plotly JSON error:', err);
            plotDiv.innerHTML = `<div style="color:red;">Error: ${err.message}</div>`;
        }
    });

}

function renderCanvasInDOM(contentDiv) {
    const canvasBlocks = contentDiv.querySelectorAll('pre code.language-canvas');

    canvasBlocks.forEach(codeBlock => {
        const code = codeBlock.textContent;
        const preElement = codeBlock.parentElement;

        const canvasId = 'canvas-' + Date.now() + Math.random();
        const canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.width = 380;
        canvas.height = 380;
        canvas.style.border = '1px solid #666';
        canvas.style.background = '#fff';

        preElement.replaceWith(canvas);

        try {
            console.log('=== Canvas Code ===');
            console.log(code);

            const ctx = canvas.getContext('2d');
            // new Function('canvas', 'ctx', code)(canvas, ctx);
            new Function('ctx', code)(ctx);

        } catch (err) {
            console.error('Canvas error:', err);
            canvas.outerHTML = `<div style="color:red;">Canvas Error: ${err.message}</div>`;
        }
    });
}

function renderSVGInDOM(contentDiv) {
    const svgBlocks = contentDiv.querySelectorAll('pre code.language-svg');

    svgBlocks.forEach(codeBlock => {
        const code = codeBlock.textContent.trim();
        const preElement = codeBlock.parentElement;

        try {
            console.log('=== SVG Code ===');
            console.log(code);

            const wrapper = document.createElement('div');
            wrapper.innerHTML = code;
            wrapper.style.textAlign = 'center';
            wrapper.style.margin = '10px 0';

            preElement.replaceWith(wrapper);

        } catch (err) {
            console.error('SVG error:', err);
            preElement.outerHTML = `<div style="color:red;">SVG Error: ${err.message}</div>`;
        }
    });
}

function renderJSInDOM(contentDiv) {
    const jsBlocks = contentDiv.querySelectorAll('pre code.language-js');

    jsBlocks.forEach(codeBlock => {
        const code = codeBlock.textContent.trim();
        const preElement = codeBlock.parentElement;

        try {
            console.log('=== JS Code ===');
            console.log(code);

            let output = '';
            const originalLog = console.log;
            console.log = (...args) => {
                output += args.join(' ') + '\n';
                originalLog(...args);
            };

            const result = new Function(code)();
            console.log = originalLog;

            const resultText = output || (result !== undefined ? String(result) : '(no output)');

            // Zwijany blok kodu
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = '📄 code';
            summary.style.cursor = 'pointer';
            summary.style.color = '#888';
            summary.style.fontSize = '0.9em';
            summary.style.marginBottom = '5px';

            details.appendChild(summary);
            details.appendChild(preElement.cloneNode(true));
            preElement.replaceWith(details);

            // Pokaż wynik
            const resultDiv = document.createElement('div');
            resultDiv.style.background = '#1a1a2e';
            resultDiv.style.color = '#0f0';
            resultDiv.style.padding = '15px';
            resultDiv.style.borderRadius = '8px';
            resultDiv.style.fontFamily = 'monospace';
            resultDiv.style.whiteSpace = 'pre-wrap';
            resultDiv.style.marginTop = '10px';
            resultDiv.innerHTML = resultText;

            details.after(resultDiv);

            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
                output = `\n\n**JS Output:**\n\`\`\`\n${resultText}\n\`\`\``;
                chatHistory[chatHistory.length - 1].content += output;
                lastCodeOutput = output;
            }

        } catch (err) {
            console.error('JS error:', err);
            const errorDiv = document.createElement('div');
            errorDiv.style.color = 'red';
            errorDiv.style.marginTop = '10px';
            errorDiv.textContent = 'Error: ' + err.message;
            preElement.after(errorDiv);

            // Dodaj błąd do historii
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
                chatHistory[chatHistory.length - 1].content += `\n\n**JS Error:** ${err.message}`;
            }
        }
    });
}

function addMessage(role, content, isLoading = false) {
    const chat = document.getElementById('chat');
    const messageDiv = document.createElement('div');
    const id = 'msg-' + Date.now();

    messageDiv.id = id;
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (isLoading) {
        contentDiv.className += ' loading';
        contentDiv.textContent = content;
    } else {
        const html = marked.parse(content);
        contentDiv.innerHTML = DOMPurify.sanitize(html);
        renderMathInElement(contentDiv, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\$', right: '\\$', display: false },  // ze slashem
                { left: '$', right: '$', display: false }       // bez slasha
            ],
            throwOnError: false
        });

        contentDiv.querySelectorAll(NO_HIGHLIGHT).forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    messageDiv.appendChild(contentDiv);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.className = 'copy-message-btn';
    copyBtn.style.cssText = 'margin-top: 10px; padding: 5px 10px; background: #1a1a2e; color: #e4e4e4; border: 1px solid #2d2d44; border-radius: 5px; cursor: pointer; font-size: 0.85em;';

    if (role === 'user') {
        copyBtn.style.float = 'right';
    } else {
        copyBtn.style.float = 'left';
    }

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(content);
        copyBtn.textContent = '✅';
        setTimeout(() => copyBtn.textContent = '📋', 2000);
    };

    messageDiv.appendChild(copyBtn);

    chat.appendChild(messageDiv);
    chat.scrollTop = chat.scrollHeight;

    return id;
}

function clearChat() {
    if (confirm('Clear entire conversation?')) {
        document.getElementById('chat').innerHTML = '';
        chatHistory.length = 0;
        addMessage('assistant', WELCOME_MSG);
    }
}

function exportChatYAML() {
    if (chatHistory.length === 0) {
        alert('No conversation to export!');
        return;
    }

    const data = {
        session_id: 'web-' + Date.now(),
        conversation: chatHistory
    };

    const yaml = jsyaml.dump(data, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
    });

    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '_');
    a.download = `chat_history_${timestamp}.yaml`;

    a.click();
    URL.revokeObjectURL(url);
}

function importChatYAML(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = jsyaml.load(e.target.result);

            if (!data.conversation || !Array.isArray(data.conversation)) {
                throw new Error('Invalid YAML format');
            }

            // Clear current chat
            chatHistory.length = 0;
            document.getElementById('chat').innerHTML = '';

            // Load conversation
            data.conversation.forEach(msg => {
                if (msg.role && msg.content) {
                    chatHistory.push({ role: msg.role, content: msg.content });
                    addMessage(msg.role, msg.content);
                }
            });

            console.log(`Imported ${chatHistory.length} messages from session: ${data.session_id}`);

        } catch (error) {
            alert('Error importing file: ' + error.message);
            console.error('Import error:', error);
        }
    };
    reader.readAsText(file);

    // Reset file input
    document.getElementById('fileInput').value = '';
}

function initEmojiBar() {

    const emojiBar = document.getElementById('emojiBar');
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        emojiBar.appendChild(btn);
    });
}

function insertEmoji(emoji) {
    const textarea = document.getElementById('input');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    emoji = " " + emoji + " "
    textarea.value = text.substring(0, start) + emoji + text.substring(end);
    const newPos = start + emoji.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
}

// Event listeners
document.getElementById('send').onclick = () => sendMessage();


input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

document.addEventListener('DOMContentLoaded', initEmojiBar);

// Focus input on load
input.focus();

// Welcome message
setTimeout(() => {
    addMessage('assistant', WELCOME_MSG);
    if (false)
        console.log(SYSTEM_PROMPT);
}, 500);

window.addEventListener('beforeunload', (e) => {
    if (chatHistory.length > 0) {
        e.preventDefault();
        e.returnValue = ''; // Chrome wymaga tego
        return ''; // Inne przeglądarki
    }
});
