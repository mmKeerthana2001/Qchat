import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText, ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

interface UploadedFile {
  filename: string;
  path: string;
}

interface UploadedFilesPanelProps {
  uploadedFiles: UploadedFile[];
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  selectedSession: string | null;
}

export function UploadedFilesPanel({ uploadedFiles, setUploadedFiles, selectedSession }: UploadedFilesPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className={`h-full bg-sidebar-bg border-l border-border flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
      <div className="p-4 border-b border-border flex items-center justify-between">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold">Uploaded Files</h2>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="ml-2"
          title={isCollapsed ? "Expand Files Panel" : "Collapse Files Panel"}
        >
          {isCollapsed ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </Button>
      </div>
      {!isCollapsed && (
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-2">
            {uploadedFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center p-4">
                No files uploaded
              </p>
            ) : (
              uploadedFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm truncate">{file.filename}</span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}