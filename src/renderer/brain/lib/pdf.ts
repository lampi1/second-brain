// pdf.js for the file viewer (SPEC 22 V2), loaded only when a PDF is opened: the bytes main read are parsed in
// pdf.js's bundled worker (offline) and pages are drawn to canvas only, with no text or annotation layer, so a PDF's
// links, forms and scripts do nothing. Used by pages/FileViewer.tsx.
import {getDocument,GlobalWorkerOptions,type PDFDocumentLoadingTask,type PDFDocumentProxy,type PDFPageProxy} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=worker;
export type {PDFDocumentProxy,PDFPageProxy};
/** pdf.js takes the buffer over (it moves to the worker), so it gets a copy and the caller keeps its bytes. */
export const openPdf=(data:Uint8Array):PDFDocumentLoadingTask=>getDocument({data:data.slice(),stopAtErrors:false,enableXfa:false});
