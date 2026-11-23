ISM — PDF WATERMARK STUDIO

Use locally on Mac:
1. Extract this folder.
2. Run Start.command (requires Python 3).
3. Open http://127.0.0.1:4173 in a modern desktop browser.
4. Choose a PDF, or select Try a sample document.
5. Enter names, one per line. Arabic and English are supported.
6. Adjust watermark style and browse source pages and recipients.
7. Select Preview all copies. Review the combined PDF before printing.
8. Select Print copies, Open PDF, or Download PDF.

The output contains the full document for the first name, then the full
document for the second name, and so on. Duplicate names are kept.
Nothing prints automatically. PDFs and names are processed in the browser;
the app does not upload or retain them. Refreshing clears the current work.

Limits: 40 MB input, 150 names, 1,500 output pages. Password-protected PDFs
are not supported. Large documents may require smaller batches. Browser
PDF preview and printing support varies; download and print in your PDF
viewer if needed. Adding a watermark does not prevent PDF editing.

Hosting:
The dist folder is a complete static website. No build step, database,
server-side processing, API keys, or external CDN dependencies are needed.
The .openai/hosting.json file retains the registered Sites project identity.
Use the deployed Site link supplied in the chat for the hosted version.

Verification:
JavaScript syntax passed. PDF copy generation and preservation of page
dimensions and rotation were checked. Browser visual and print-dialog QA
could not be completed because browser automation was unavailable.

Bundled dependencies:
pdf-lib 1.17.1 (MIT), PDF.js 4.10.38 (Apache-2.0),
Noto Sans Arabic (SIL Open Font License). Licenses are in dist/vendor.
