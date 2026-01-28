/**
 * Script to fix corrupted Y.js state and re-encode to base64
 * Run with: bun scripts/fix-memo.ts
 */
import * as Y from 'yjs';

// Full base64 data from recover-memo.ts
const base64State = `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`;

// Decode base64 to Uint8Array
const binaryString = atob(base64State);
const bytes = new Uint8Array(binaryString.length);
for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
}

console.log('Decoded', bytes.length, 'bytes from original state');

// Create Y.Doc and apply the state
const ydoc = new Y.Doc();
Y.applyUpdate(ydoc, bytes);
console.log('Successfully applied Y.js update');

// Get the prosemirror content
const prosemirror = ydoc.getXmlFragment('prosemirror');

// Debug - list all top-level elements
console.log('\n--- Top-level elements ---');
let idx = 0;
prosemirror.forEach((child) => {
    if (child instanceof Y.XmlElement) {
        console.log(`[${idx}] ${child.nodeName}`);
    } else if (child instanceof Y.XmlText) {
        console.log(`[${idx}] (text)`);
    } else {
        console.log(`[${idx}] (unknown type)`);
    }
    idx++;
});

// Find and remove the todobox element
const toRemove: number[] = [];
idx = 0;

prosemirror.forEach((child) => {
    if (child instanceof Y.XmlElement) {
        const nodeName = child.nodeName;
        // Check for todobox or todoBox (case variations)
        if (nodeName === 'todobox' || nodeName === 'todoBox') {
            toRemove.push(idx);
            console.log('\nFound todobox to remove at index', idx, 'with nodeName:', nodeName);
        }
    }
    idx++;
});

console.log('\nElements to remove:', toRemove);

// Remove in reverse order to maintain correct indices
if (toRemove.length > 0) {
    ydoc.transact(() => {
        for (let i = toRemove.length - 1; i >= 0; i--) {
            prosemirror.delete(toRemove[i], 1);
            console.log('Removed element at index', toRemove[i]);
        }
    });
}

// Also check and remove empty heading at the end
const lastIdx = prosemirror.length - 1;
if (lastIdx >= 0) {
    const lastChild = prosemirror.get(lastIdx);
    if (lastChild instanceof Y.XmlElement && lastChild.nodeName === 'heading') {
        const content = lastChild.toString();
        if (content === '<heading level="1"></heading>' || lastChild.length === 0) {
            ydoc.transact(() => {
                prosemirror.delete(lastIdx, 1);
                console.log('Removed empty heading at end');
            });
        }
    }
}

// Encode the fixed state
const fixedState = Y.encodeStateAsUpdate(ydoc);
console.log('\nFixed state:', fixedState.length, 'bytes');

// Convert to base64
const fixedBase64 = btoa(String.fromCharCode(...fixedState));

console.log('\n========== FIXED BASE64 STATE ==========');
console.log(fixedBase64);
console.log('========== END ==========');

// Verify - show full content
console.log('\n--- Full Verified Content ---');
const fullContent = prosemirror.toString();
console.log(fullContent);

// Check if todobox is still there
if (fullContent.includes('todobox') || fullContent.includes('todoBox')) {
    console.log('\n⚠️ WARNING: todobox still found in content!');
} else {
    console.log('\n✓ todobox successfully removed!');
}
