import { VideoCompositions } from "@/framework/video/define-video";
import { VIDEOS } from "./videos/registry";

export const RemotionRoot: React.FC = () => <VideoCompositions videos={VIDEOS} />;
