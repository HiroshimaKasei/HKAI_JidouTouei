export type PromptPoint = {
  x: number;
  y: number;
  label: 0 | 1;
};

export type SampleTransform = {
  tx: number;
  ty: number;
  rotationDeg: number;
  visible: boolean;
  color: string;
};

export type SampleData = {
  sampleId: string;
  captureId: string;
  pageNumber: number;
  width: number;
  height: number;
  prompts: PromptPoint[];
  outerContours: number[][][];
  holeContours: number[][][];
  transform: SampleTransform;
  capturePngHex?: string;
  maskPngHex?: string;
  contourBwPngHex?: string;
  captureFile?: string;
  maskFile?: string;
  contourBwFile?: string;
};

export type CameraStatus = {
  camera_available: boolean;
  camera_name: string;
  mode: "camera" | "test";
};
