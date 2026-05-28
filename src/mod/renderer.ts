import { initAudioElementTracker } from "~/mod/features/utils/audio-element-tracker";
import { initFetchInterceptor } from "~/mod/features/utils";
import { initTrackMetaStore } from "~/mod/features/utils/track-meta-store";

// ВАЖНО: трекер audio-элементов должен быть инициализирован ДО любого другого
// кода — он monkey-patch'ит document.createElement и должен сработать
// раньше чем Yandex Music создаст первый <audio>.
initAudioElementTracker();

// Инициализация мода utils для перехвата запросов к yandex api
initFetchInterceptor();

// Track meta store — слушает /get-file-info и подтягивает мета через /tracks.
// Должен быть после initFetchInterceptor (он использует onYandexApiRequest).
initTrackMetaStore();

// Инициализация мода на разблокировку плюса
import "./features/plus-unlocker";

// Инициализация интерфейса мода
import "./features/ui/index";

// Инициализация мода на изменение шрифта
import "./features/font-changer";

// Инициализация мода на изменение размера интерфейса
import "./features/scale-changer";

// Инициализация мода на кастомные темы
import "./features/custom-themes";

// Инициализация мода на режим разработчика
import "./features/devtools";

// Инициализация мода авто-выбора качества
import "./features/auto-best-quality";

// Инициализация renderer части мода discordRPC
import "./features/discord-RPC/discordRPC";

// Инициализация settings
import "./features/settings";

// Инициализация мода для переопределения экспериментов
import "./features/experiments-toggle";
