import type { InjectionKey, Ref } from "vue";
import type { SceneController } from "../../core/src/controller/sceneController";

export const controllerKey: InjectionKey<Ref<SceneController | null>> = Symbol("voxcss-controller");
