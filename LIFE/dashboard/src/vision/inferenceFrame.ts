const MAX_INFERENCE_WIDTH = 800;

let inferenceCanvas: HTMLCanvasElement | null = null;

export function prepareInferenceFrame(video: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
  if (!video.videoWidth || video.videoWidth <= MAX_INFERENCE_WIDTH) {
    return video;
  }

  const scale = MAX_INFERENCE_WIDTH / video.videoWidth;
  const width = MAX_INFERENCE_WIDTH;
  const height = Math.round(video.videoHeight * scale);

  if (!inferenceCanvas) {
    inferenceCanvas = document.createElement('canvas');
  }

  if (inferenceCanvas.width !== width || inferenceCanvas.height !== height) {
    inferenceCanvas.width = width;
    inferenceCanvas.height = height;
  }

  const context = inferenceCanvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to prepare a camera frame for vision tracking');
  }

  context.drawImage(video, 0, 0, width, height);
  return inferenceCanvas;
}

export function mapVideoPointToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  x: number,
  y: number
): { x: number; y: number } {
  const videoAspect = video.videoWidth / video.videoHeight;
  const canvasAspect = canvas.width / canvas.height;

  if (videoAspect > canvasAspect) {
    const visibleWidth = canvasAspect / videoAspect;
    return {
      x: (x - (1 - visibleWidth) / 2) / visibleWidth * canvas.width,
      y: y * canvas.height,
    };
  }

  const visibleHeight = videoAspect / canvasAspect;
  return {
    x: x * canvas.width,
    y: (y - (1 - visibleHeight) / 2) / visibleHeight * canvas.height,
  };
}
