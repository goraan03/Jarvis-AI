export const BROWSER_TASK_QUEUE_NAME = "browser-tasks";

export interface BrowsePageJobData {
  url: string;
}
export interface FillFormJobData {
  url: string;
  fields: Array<{ selector: string; value: string }>;
  submitSelector?: string;
}
export interface DownloadFileJobData {
  url: string;
  taskId: string;
}

export type BrowserJobName = "browse_page" | "fill_form" | "download_file";
export type BrowserJobData = BrowsePageJobData | FillFormJobData | DownloadFileJobData;

export interface BrowsePageResult {
  finalUrl: string;
  title: string;
  text: string;
  actions: string[];
}
export interface FillFormResult {
  finalUrl: string;
  title: string;
  actions: string[];
}
export interface DownloadFileResult {
  filename: string;
  sizeBytes: number;
  contentType: string;
  path: string;
}
