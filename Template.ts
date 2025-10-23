const enableDebug: boolean = true;
const aiSpawnerProvidedId: number = 101;
const zeroVector: mod.Vector = mod.CreateVector(0, 0, 0);

export async function OnGameModeStarted() {
    // Spawn DeployCam runtime
    const pos = mod.GetObjectPosition(mod.GetHQ(1));
    const rot = mod.CreateVector(mod.DegreesToRadians(-1), 0, 0);
    mod.SpawnObject(mod.RuntimeSpawn_Common.DeployCam, pos, rot);

    AISpawner.Initialize(mod.GetSpawner(aiSpawnerProvidedId));
}

export function OnPlayerJoinGame(eventPlayer: mod.Player) {
}

export function OnPlayerLeaveGame(eventNumber: number) {
}

export function OnSpawnerSpawned(eventPlayer: mod.Player, eventSpawner: mod.Spawner) {
    AISpawner.OnSpawned(eventPlayer, eventSpawner);
}

export function OnPlayerDeployed(eventPlayer: mod.Player) {
    AISpawner.OnDeployed(eventPlayer);
}

export function OnPlayerUndeploy(eventPlayer: mod.Player) {
}

export function OngoingGlobal() {
    DebugBoard.Set(0, AISpawner.spawnQueueLength);
}

export function OnRayCastHit(eventPlayer: mod.Player, eventPoint: mod.Vector, eventNormal: mod.Vector) {
    Raycaster.OnHit(eventPlayer, eventPoint, eventNormal);
}

export function OnRayCastMissed(eventPlayer: mod.Player) {
    Raycaster.OnMissed(eventPlayer);
}

export function OnPlayerInteract(eventPlayer: mod.Player, eventInteractPoint: mod.InteractPoint) {
    Interactor.OnInteract(eventPlayer, eventInteractPoint);
}

class SoldierStateTrigger {
    isActive: boolean = true;
    #player: mod.Player;
    #state: mod.SoldierStateBool;
    #onTriggered: (player: mod.Player) => void;
    #lastState: boolean = false;

    constructor(player: mod.Player, state: mod.SoldierStateBool, onTriggered: (player: mod.Player) => void) {
        this.#player = player;
        this.#state = state;
        this.#onTriggered = onTriggered;
        void this.#CheckStateLoop();
    }

    async #CheckStateLoop() {
        const tick = 1 / 60;
        while (this.isActive) {
            const currentState = mod.GetSoldierState(this.#player, this.#state);
            if (currentState && !this.#lastState) {
                this.#onTriggered(this.#player);
            }
            this.#lastState = currentState;
            await mod.Wait(tick);
        }
    }
}

type AISpawnParameter = {
    position: mod.Vector,
    orientation: number,
    class: mod.SoldierClass | undefined;
    name: mod.Message;
    team: mod.Team;
};

class AISpawner {
    static isActive: boolean = true;
    static #spawner: mod.Spawner;
    static #spawnQueue: AISpawnParameter[] = [];
    static #processingParam: AISpawnParameter | undefined = undefined;
    static #processingPlayer: mod.Player | undefined = undefined;
    static #isProcessingPlayerDeployed: boolean = false;

    static get spawnQueueLength() {
        return this.#spawnQueue.length;
    }

    static Initialize(aiSpawner: mod.Spawner) {
        this.#spawner = aiSpawner;
    }

    static async Spawn(parameter: AISpawnParameter): Promise<mod.Player | undefined> {
        this.#spawnQueue.push(parameter);
        this.#TrySpawnNext();
        const player = await this.#WaitDeploy(parameter, 1);
        this.#processingParam = undefined;
        this.#TrySpawnNext();
        return player;
    }

    static async #WaitDeploy(parameter: AISpawnParameter, timeout: number): Promise<mod.Player | undefined> {
        const tick = 1 / 60;
        let elapsedTime = 0;
        while (elapsedTime < timeout) {
            if (this.#processingParam == parameter) {
                elapsedTime += tick;
                if (this.#processingPlayer && this.#isProcessingPlayerDeployed) {
                    return this.#processingPlayer;
                }
            }
            await mod.Wait(tick);
        }
        return;
    }

    static #TrySpawnNext() {
        if (!this.#processingParam) {
            const param = this.#spawnQueue.shift();
            if (param) {
                this.#processingParam = param;
                this.#processingPlayer = undefined;
                this.#isProcessingPlayerDeployed = false;
                if (param.class) {
                    mod.SpawnAIFromAISpawner(this.#spawner, param.class, param.name, param.team);
                } else {
                    mod.SpawnAIFromAISpawner(this.#spawner, param.name, param.team);
                }
            }
        }
    }

    static OnSpawned(player: mod.Player, spawner: mod.Spawner) {
        if (this.#processingParam && mod.Equals(spawner, this.#spawner)) {
            this.#processingPlayer = player;
        }
    }

    static OnDeployed(player: mod.Player) {
        if (this.#processingParam && mod.Equals(player, this.#processingPlayer)) {
            this.#isProcessingPlayerDeployed = true;
            mod.Teleport(player, this.#processingParam.position, this.#processingParam.orientation);
        }
    }
}

type RaycastResult = {
    isHit: boolean;
    hitPosition: mod.Vector;
    hitNormal: mod.Vector;
}

class Raycaster {
    isActive: boolean = true;
    #queue: { start: mod.Vector, end: mod.Vector }[] = [];
    #isProcessing: boolean = false;
    #processingParam: { start: mod.Vector, end: mod.Vector } | undefined = undefined;
    #processingResult: RaycastResult | undefined = undefined;

    async Linecast(start: mod.Vector, end: mod.Vector): Promise<RaycastResult> {
        const param = {start, end};
        this.#queue.push(param);
        this.#CheckNext();
        const result = await this.#WaitResult(param);
        this.#isProcessing = false;
        this.#CheckNext();
        return result;
    }

    async Raycast(origin: mod.Vector, direction: mod.Vector, distance: number): Promise<RaycastResult> {
        const endPosition = mod.Add(origin, mod.Multiply(direction, distance));
        return await this.Linecast(origin, endPosition);
    }

    async #WaitResult(param: { start: mod.Vector, end: mod.Vector }): Promise<RaycastResult> {
        const tick = 1 / 60;
        while (this.isActive) {
            if (this.#isProcessing && this.#processingParam == param && this.#processingResult) {
                break;
            }
            await mod.Wait(tick);
        }
        return this.#processingResult!;
    }

    #CheckNext() {
        if (!this.#isProcessing) {
            const param = this.#queue.shift();
            if (param) {
                this.#isProcessing = true
                this.#processingParam = param;
                this.#processingResult = undefined;
                mod.RayCast(param.start, param.end);
            }
        }
    }

    #OnHit(hitPosition: mod.Vector, hitNormal: mod.Vector) {
        if (this.#isProcessing) {
            this.#processingResult = {isHit: true, hitPosition, hitNormal};
        }
    }

    #OnMissed() {
        if (this.#isProcessing) {
            this.#processingResult = {isHit: false, hitPosition: zeroVector, hitNormal: zeroVector};
        }
    }

    static #raycasters: Map<number, Raycaster> = new Map();

    static Create(player: mod.Player | undefined): Raycaster {
        const raycaster = new Raycaster();
        const id = player ? mod.GetObjId(player) : -1;
        this.#raycasters.set(id, raycaster);
        return raycaster;
    }

    static OnHit(player: mod.Player | undefined, hitPosition: mod.Vector, direction: mod.Vector) {
        const id = player ? mod.GetObjId(player) : -1;
        const raycaster = this.#raycasters.get(id);
        if (raycaster) {
            raycaster.#OnHit(hitPosition, direction);
        }
    }

    static OnMissed(player: mod.Player | undefined) {
        const id = player ? mod.GetObjId(player) : -1;
        const raycaster = this.#raycasters.get(id);
        if (raycaster) {
            raycaster.#OnMissed();
        }
    }
}

const globalRaycaster: Raycaster = Raycaster.Create(undefined);

class Interactor {
    static interactWaitingData: Map<number, {
        interactPoint: mod.InteractPoint,
        callback: (player: mod.Player) => void
    }> = new Map();

    static Register(interactPoint: mod.InteractPoint, callback: (player: mod.Player) => void): void {
        const objId = mod.GetObjId(interactPoint);
        this.interactWaitingData.set(objId, {interactPoint, callback});
    }

    static Unregister(interactPoint: mod.InteractPoint): void {
        const objId = mod.GetObjId(interactPoint);
        this.interactWaitingData.delete(objId);
    }

    static OnInteract(player: mod.Player, interactPoint: mod.InteractPoint): void {
        const objId = mod.GetObjId(interactPoint);
        const data = this.interactWaitingData.get(objId);
        if (data) {
            data.callback(player);
        }
    }
}

//
// Utilities
//

class UniqueID {
    static #lastId: number = 0;

    static GetString(): string {
        this.#lastId++;
        return mod.Concat("_UNIQUE_ID_", this.#lastId.toString());
    }
}

function SqrMagnitudeXZ(v: mod.Vector): number {
    const x = mod.XComponentOf(v);
    const y = mod.YComponentOf(v);
    return x * x + y * y;
}

function LerpVector(start: mod.Vector, end: mod.Vector, t: number): mod.Vector {
    const distance = mod.DistanceBetween(start, end);
    const direction = mod.DirectionTowards(start, end);
    return mod.Add(start, mod.Multiply(direction, distance * t));
}

class VoiceOver {
    static #voiceOverFlags: mod.VoiceOverFlags[] = [
        mod.VoiceOverFlags.Alpha,
        mod.VoiceOverFlags.Bravo,
        mod.VoiceOverFlags.Charlie,
        mod.VoiceOverFlags.Delta,
        mod.VoiceOverFlags.Echo,
        mod.VoiceOverFlags.Foxtrot,
        mod.VoiceOverFlags.Golf,
    ]

    static GetFlag(index: number): mod.VoiceOverFlags {
        return index < this.#voiceOverFlags.length ? this.#voiceOverFlags[index] : this.#voiceOverFlags[0];
    }
}


//
// Debugs
//

function DebugLog(message: mod.Message) {
    if (enableDebug) {
        mod.DisplayHighlightedWorldLogMessage(message);
        mod.DisplayNotificationMessage(message)
    }
}

class DebugBoard {
    #key: number;
    #text: mod.UIWidget;

    constructor(key: number, value: number) {
        this.#key = key;
        const textName = UniqueID.GetString();
        mod.AddUIText(
            textName,
            mod.CreateVector(10, 10 + this.#key * 50, 0),
            mod.CreateVector(200, 50, 0),
            mod.UIAnchor.TopCenter,
            mod.Message(mod.stringkeys.dbg_board, key, value)
        );
        this.#text = mod.FindUIWidgetWithName(textName);
        mod.SetUIWidgetAnchor(this.#text, mod.UIAnchor.TopLeft);
        mod.SetUITextAnchor(this.#text, mod.UIAnchor.CenterLeft);
    }

    #SetValue(value: number) {
        mod.SetUITextLabel(this.#text, mod.Message(mod.stringkeys.dbg_board, this.#key, value));
    }

    static #elements: Map<number, DebugBoard> = new Map();

    static Set(key: number, value: number) {
        if (!enableDebug) {
            return;
        }

        const element = this.#elements.get(key)
        if (element) {
            element.#SetValue(value);
        } else {
            const element = new DebugBoard(key, value);
            this.#elements.set(key, element);
        }
    }
}
