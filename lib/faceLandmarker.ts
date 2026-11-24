import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

const WASM_PATH = "/wasm";
const MODEL_PATH = "/models/face_landmarker.task";

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function createFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = {
    runningMode: "VIDEO" as const,
    outputFaceBlendshapes: true,
    numFaces: 1,
  };

  try {
    return await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    });
  } catch (gpuError) {
    console.warn(
      `[MediaPipe] GPU initialization failed; retrying with CPU: ${describeError(gpuError)}`,
      gpuError,
    );
    try {
      return await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      });
    } catch (cpuError) {
      throw new Error(
        `GPU initialization failed: ${describeError(gpuError)}; CPU initialization failed: ${describeError(cpuError)}`,
      );
    }
  }
}
