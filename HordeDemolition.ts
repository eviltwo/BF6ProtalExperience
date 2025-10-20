import InventorySlots = mod.InventorySlots;

const enableDebug: boolean = false;

const aiSpawnerId: number = 101;

const zeroVector: mod.Vector = mod.CreateVector(0, 0, 0);

export async function OnGameModeStarted() {
    const pos = mod.GetObjectPosition(mod.GetHQ(1));
    const rot = mod.CreateVector(mod.DegreesToRadians(-1), 0, 0);
    mod.SpawnObject(mod.RuntimeSpawn_Common.DeployCam, pos, rot);

    const safetyAreaFX = mod.SpawnObject(mod.RuntimeSpawn_Common.FX_Gadget_SupplyCrate_Range_Indicator, mod.GetObjectPosition(mod.GetHQ(1)), mod.CreateVector(0, 0, 0));
    mod.EnableVFX(safetyAreaFX, true);

    AISpawner.Setup(aiSpawnerId);
    AISpawner.team = mod.GetTeam(2);
    ZombieManager.team = mod.GetTeam(2);
    ZombiePenalty.Setup();
    GameDirector.Setup();
}

export function OnPlayerJoinGame(eventPlayer: mod.Player) {
    PlayerNotifications.Create(eventPlayer);
}

export function OnPlayerLeaveGame(eventNumber: number) {
    PlayerNotifications.Destroy(eventNumber);
}

export function OnPlayerDeployed(eventPlayer: mod.Player): void {
    SurvivorModifier.OnDeployed(eventPlayer);
    AISpawner.OnDeployed(eventPlayer);
    ZombieModifier.OnDeploy(eventPlayer);
    ZombieManager.OnDeployed(eventPlayer);
    PlayerNotifications.Get(eventPlayer)?.Push({
        message: mod.Message(mod.stringkeys.briefing),
        minDuration: 5,
        maxDuration: 10
    });
}

export function OnPlayerUndeploy(eventPlayer: mod.Player) {
    ZombieManager.OnUndeployed(eventPlayer);
}

export function OngoingGlobal(): void {
    ZombieManager.OnUpdate();

    DebugBoard.Set(0, ZombieManager.GetInstanceCount());
    DebugBoard.Set(1, ZombieManager.GetAliveCount());
    DebugBoard.Set(2, AISpawner.GetWaitingCount());
    DebugBoard.Set(3, GameDirector.targetZombieCount);
}

export function OnRayCastHit(
    eventPlayer: mod.Player,
    eventPoint: mod.Vector,
    eventNormal: mod.Vector): void {
    if (!eventPlayer || mod.GetObjId(eventPlayer) < 0) {
        Raycaster.OnHit(eventPoint, eventNormal);
    }
}

export function OnRayCastMissed(eventPlayer: mod.Player): void {
    if (!eventPlayer || mod.GetObjId(eventPlayer) < 0) {
        Raycaster.OnMissed();
    }
}

export function OnPlayerInteract(eventPlayer: mod.Player, eventInteractPoint: mod.InteractPoint): void {
    Interactor.OnInteract(eventPlayer, eventInteractPoint);
}

class AISpawnParameter {
    position: mod.Vector;
    orientation: number;

    constructor(position: mod.Vector, orientation: number) {
        this.position = position;
        this.orientation = orientation;
    }
}

class AISpawner {
    static spawner: mod.Spawner;
    static team: mod.Team;
    static #isDeploying: boolean = false;
    static waitingDeployParams: AISpawnParameter[] = [];

    static Setup(aiSpawnerIdForLocalServer: number): void {
        this.spawner = mod.GetSpawner(aiSpawnerIdForLocalServer);
    }

    static OnDeployed(player: mod.Player): void {
        if (mod.Equals(mod.GetTeam(player), this.team)) {
            this.#isDeploying = false;
            const param = this.waitingDeployParams.shift()
            if (param) {
                mod.Teleport(player, param.position, param.orientation);
                this.#TrySpawnNext();
            }
        }
    }

    static Spawn(parameters: AISpawnParameter): void {
        this.waitingDeployParams.push(parameters);
        this.#TrySpawnNext();
    }

    static #TrySpawnNext() {
        if (!this.#isDeploying && this.waitingDeployParams.length > 0) {
            this.#isDeploying = true;
            mod.SpawnAIFromAISpawner(this.spawner, mod.Message(mod.stringkeys.enemy_name), this.team);
        }
    }

    static GetWaitingCount(): number {
        return this.waitingDeployParams.length;
    }
}

type RaycastResult = {
    isHit: boolean;
    hitPosition: mod.Vector;
    hitNormal: mod.Vector;
}

type RaycastWaitingData = {
    startPosition: mod.Vector;
    endPosition: mod.Vector;
    callback: (result: RaycastResult) => void;
}

class Raycaster {
    static #queue: RaycastWaitingData[] = [];
    static #isRunning: boolean = false;

    static async RaycastBetween(startPosition: mod.Vector, endPosition: mod.Vector): Promise<RaycastResult> {
        let returnValue: RaycastResult | undefined = undefined;
        const callback = (result: RaycastResult): void => {
            returnValue = result;
        }
        const data = {startPosition, endPosition, callback};
        this.#queue.push(data);
        this.CheckNext();
        while (!returnValue) {
            await mod.Wait(0.01);
        }

        return returnValue;
    }

    static async Raycast(origin: mod.Vector, direction: mod.Vector, distance: number): Promise<RaycastResult> {
        const endPosition = mod.Add(origin, mod.Multiply(direction, distance));
        return await this.RaycastBetween(origin, endPosition);
    }

    static OnHit(hitPosition: mod.Vector, hitNormal: mod.Vector): void {
        this.#isRunning = false;
        const data = this.#queue.shift();
        if (data) {
            data.callback({
                isHit: true,
                hitPosition,
                hitNormal
            });
        }

        this.CheckNext();
    }

    static OnMissed(): void {
        this.#isRunning = false;
        const data = this.#queue.shift();
        if (data) {
            data.callback({
                isHit: false,
                hitPosition: zeroVector,
                hitNormal: zeroVector
            });
        }

        this.CheckNext();
    }

    static CheckNext() {
        if (!this.#isRunning && this.#queue.length > 0) {
            this.#isRunning = true;
            const firstData = this.#queue[0];
            mod.RayCast(firstData.startPosition, firstData.endPosition);
        }
    }
}

type InteractResult = {
    player: mod.Player;
    payload: any;
}

type InteractWaitingData = {
    interactPoint: mod.InteractPoint;
    payload: any;
    callback: (result: InteractResult) => void;
}

class Interactor {
    static interactWaitingData: Map<number, InteractWaitingData> = new Map();

    static Register(interactPoint: mod.InteractPoint, callback: (result: InteractResult) => void, payload: any = undefined): void {
        const objId = mod.GetObjId(interactPoint);
        this.interactWaitingData.set(objId, {interactPoint, payload, callback});
    }

    static Unregister(interactPoint: mod.InteractPoint): void {
        const objId = mod.GetObjId(interactPoint);
        this.interactWaitingData.delete(objId);
    }

    static OnInteract(eventPlayer: mod.Player, interactPoint: mod.InteractPoint): void {
        const objId = mod.GetObjId(interactPoint);
        const data = this.interactWaitingData.get(objId);
        if (data) {
            data.callback({player: eventPlayer, payload: data.payload});
        }
    }
}

enum ZombieBehavior {
    Move,
    BattleField,
}

const zombieBehaviorInterval = 120;
const zombieMoveUpdateInterval = 30;
const zombieBattleDistance = 0;
const zombieFindTargetInterval = 120;

class Zombie {
    player: mod.Player;
    playerId: number;
    targetPosition: mod.Vector = zeroVector;
    targetEyePosition: mod.Vector = zeroVector;
    targetPlayer: mod.Player | undefined;
    behavior: ZombieBehavior = ZombieBehavior.Move;
    behaviorElapsedFrame: number = zombieBehaviorInterval;
    moveBehaviorUpdateElapsedFrame: number = 0;
    findTargetElapsedFrame: number = 0;
    penaltyStack: number = 0;

    constructor(player: mod.Player) {
        this.player = player;
        this.playerId = mod.GetObjId(player);
        this.ChangeBehavior(this.behavior);
    }

    IsAlive(): boolean {
        return this.player && mod.GetObjId(this.player) >= 0 && mod.GetSoldierState(this.player, mod.SoldierStateBool.IsAlive);
    }

    HasInstance(): boolean {
        return this.player && mod.GetObjId(this.player) >= 0;
    }

    Update(): void {
        if (!this.targetPlayer || !mod.GetSoldierState(this.targetPlayer, mod.SoldierStateBool.IsAlive)) {
            this.targetPlayer = undefined;
        }

        this.findTargetElapsedFrame++;
        if (this.findTargetElapsedFrame > zombieFindTargetInterval) {
            this.findTargetElapsedFrame = 0;
            //this.targetPlayer = FindClosestPlayer(mod.GetObjectPosition(this.player), mod.GetTeam(1));
        }

        if (this.targetPlayer) {
            this.targetPosition = mod.GetObjectPosition(this.targetPlayer);
            this.targetEyePosition = mod.GetSoldierState(this.targetPlayer, mod.SoldierStateVector.EyePosition);
        }

        if (this.behavior == ZombieBehavior.Move) {
            if (this.targetPlayer) {
                //mod.AISetTarget(this.player, this.targetPlayer); // Crashes when dying on an online server.
                mod.AISetFocusPoint(this.player, this.targetEyePosition, true);
            } else {
                mod.AISetFocusPoint(this.player, this.targetEyePosition, true);
            }
        }

        if (this.behavior == ZombieBehavior.Move) {
            this.moveBehaviorUpdateElapsedFrame++;
            if (this.moveBehaviorUpdateElapsedFrame > zombieMoveUpdateInterval) {
                this.moveBehaviorUpdateElapsedFrame = 0;
                mod.AIMoveToBehavior(this.player, this.targetPosition);
            }
        }

        const targetDistance = mod.DistanceBetween(mod.GetObjectPosition(this.player), this.targetPosition);
        if (targetDistance < zombieBattleDistance && this.targetPlayer) {
            if (this.behavior != ZombieBehavior.BattleField) {
                this.ChangeBehavior(ZombieBehavior.BattleField);
            }
        } else {
            this.behaviorElapsedFrame++;
            if (this.behaviorElapsedFrame > zombieBehaviorInterval) {
                this.behaviorElapsedFrame = 0;
                this.targetPlayer = FindClosestPlayer(mod.GetObjectPosition(this.player), mod.GetTeam(1));
                if (!this.targetPlayer) {
                    this.targetPosition = mod.GetObjectPosition(mod.GetHQ(2));
                    this.targetEyePosition = this.targetPosition;
                }

                this.ChangeBehavior(this.behavior == ZombieBehavior.Move ? ZombieBehavior.BattleField : ZombieBehavior.Move);
            }
        }
    }

    ChangeBehavior(behavior: ZombieBehavior) {
        this.behavior = behavior;
        switch (behavior) {
            case ZombieBehavior.Move:
                mod.AIMoveToBehavior(this.player, this.targetPosition);
                break;
            case ZombieBehavior.BattleField:
                mod.AIBattlefieldBehavior(this.player);
                break;
        }
    }
}

class ZombieModifier {
    static team: mod.Team = mod.GetTeam(2);

    static OnDeploy(player: mod.Player) {
        if (mod.Equals(mod.GetTeam(player), this.team)) {
            // Fix for using smoke grenade
            mod.RemoveEquipment(player, InventorySlots.Throwable);
        }
    }
}

class ZombieManager {
    static team: mod.Team = mod.GetTeam(2);
    static allZombies: Map<number, Zombie> = new Map();

    static OnDeployed(player: mod.Player) {
        if (mod.Equals(mod.GetTeam(player), this.team)) {
            const playerId = mod.GetObjId(player);
            this.allZombies.set(playerId, new Zombie(player));
        }
    }

    static OnUndeployed(player: mod.Player) {
        if (mod.Equals(mod.GetTeam(player), this.team)) {
            const playerId = mod.GetObjId(player);
            const zombie = this.allZombies.get(playerId);
            if (zombie) {
                this.allZombies.delete(playerId);
            }
        }
    }

    static OnUpdate() {
        const zombies = this.allZombies.values();
        for (const zombie of zombies) {
            zombie.Update()
        }

        for (const zombie of zombies) {
            if (!zombie.HasInstance()) {
                this.allZombies.delete(zombie.playerId);
                break;
            }
        }
    }

    static GetZombie(player: mod.Player): Zombie | undefined {
        return this.allZombies.get(mod.GetObjId(player));
    }

    static GetAliveCount(): number {
        let count = 0;
        const zombies = this.allZombies.values();
        for (const zombie of zombies) {
            if (zombie.IsAlive()) {
                count++;
            }
        }

        return count;
    }

    static GetInstanceCount(): number {
        return this.allZombies.size;
    }
}

type ZombieNestSettings = {
    nameKey: any;
    position: mod.Vector;
    orientation: number;
    isShowTargetText: boolean;
    bombTimerDuration: number;
    voiceOverFlag: mod.VoiceOverFlags;
}

class ZombieNest {
    position: mod.Vector;
    rotation: mod.Vector;
    settings: ZombieNestSettings;
    #worldIcon: mod.WorldIcon;
    #interactPoint: mod.InteractPoint;
    #bombObj: any;
    #voiceOver: mod.VO;
    #alarmSound: mod.SFX;
    #explosionEffect: mod.VFX;
    #areaEffect: mod.VFX;
    spawnRemainCount: number = 0;
    isAlive: boolean = true;
    #isArmed: boolean = false;
    #isPlayingAlarm: boolean = false;
    #areaRadius: number = 20;

    // Set position and orientation (radian)
    constructor(settings: ZombieNestSettings) {
        this.settings = settings;
        this.position = this.settings.position;
        this.rotation = mod.CreateVector(0, this.settings.orientation, 0);

        this.#worldIcon = mod.SpawnObject(mod.RuntimeSpawn_Common.WorldIcon, mod.Add(this.position, mod.Multiply(mod.UpVector(), 0.3)), this.rotation);
        this.#interactPoint = mod.SpawnObject(mod.RuntimeSpawn_Common.InteractPoint, mod.Add(this.position, mod.Multiply(mod.UpVector(), 0.3)), this.rotation);
        this.#bombObj = mod.SpawnObject(mod.RuntimeSpawn_Common.OrdinanceCrate_01, this.position, this.rotation);
        this.#voiceOver = mod.SpawnObject(mod.RuntimeSpawn_Common.SFX_VOModule_OneShot2D, zeroVector, zeroVector);
        this.#alarmSound = mod.SpawnObject(mod.RuntimeSpawn_Common.SFX_Alarm, this.position, this.rotation);
        this.#areaEffect = mod.SpawnObject(mod.RuntimeSpawn_Common.FX_SupplyVehicleStation_Range_Indicator, this.position, this.rotation);
        this.#explosionEffect = mod.SpawnObject(mod.RuntimeSpawn_Common.FX_CivCar_SUV_Explosion, this.position, this.rotation);
        this.SetupObjects();
        void this.#RepeatSpawnCheck();
    }

    #UnspawnObjects() {
        mod.UnspawnObject(this.#worldIcon);
        mod.UnspawnObject(this.#interactPoint);
        mod.UnspawnObject(this.#bombObj);
        mod.UnspawnObject(this.#alarmSound);
        mod.UnspawnObject(this.#areaEffect);
    }

    SetupObjects() {
        // SFX
        mod.SetSFXVolume(this.#alarmSound, 0.5);

        // World icon
        //mod.SetWorldIconPosition(this.worldIcon, mod.GetObjectPosition(this.worldIcon));
        mod.SetWorldIconImage(this.#worldIcon, mod.WorldIconImages.Bomb);
        mod.SetWorldIconColor(this.#worldIcon, mod.CreateVector(1, 1, 1))
        mod.SetWorldIconText(this.#worldIcon, mod.Message(mod.stringkeys.target));
        mod.EnableWorldIconImage(this.#worldIcon, true);
        mod.EnableWorldIconText(this.#worldIcon, this.settings.isShowTargetText);
        mod.SetWorldIconOwner(this.#worldIcon, mod.GetTeam(1));

        // Interact
        mod.EnableInteractPoint(this.#interactPoint, true);
        Interactor.Register(this.#interactPoint, this.OnInteractBomb.bind(this));
    }

    Spawn(count: number): void {
        this.spawnRemainCount += count;
    }

    async #RepeatSpawnCheck() {
        const tick = 1 / 60;
        while (this.isAlive) {
            await mod.Wait(tick);
            if (this.spawnRemainCount > 0) {
                this.spawnRemainCount--;
                AISpawner.Spawn(new AISpawnParameter(mod.Add(this.position, mod.UpVector()), mod.YComponentOf(this.rotation)));
            }
        }
    }

    OnInteractBomb(result: InteractResult): void {
        if (!this.#isArmed) {
            this.#isArmed = true;
            void this.#PlayArmedBombSequence(result.player);
        }
    }

    async #PlayArmedBombSequence(armedPlayer: mod.Player) {
        mod.EnableVFX(this.#areaEffect, true);
        mod.PlayVO(this.#voiceOver, mod.VoiceOverEvents2D.MComArmFriendly, this.settings.voiceOverFlag);
        mod.EnableInteractPoint(this.#interactPoint, false);
        mod.SetWorldIconText(this.#worldIcon, mod.Message(mod.stringkeys.percentage, 0, 0));
        mod.EnableWorldIconText(this.#worldIcon, true);

        PlayerNotifications.PushToAll({
            message: mod.Message(mod.stringkeys.bomb_armed, armedPlayer),
            minDuration: 2,
            maxDuration: 5
        });

        const tick = 1 / 60;
        let elapsedTime = 0;
        while (this.isAlive && elapsedTime < this.settings.bombTimerDuration) {
            await mod.Wait(tick);
            const isInArea = this.#IsInAreaAnyPlayer();
            if (isInArea) elapsedTime += tick;
            if (isInArea != this.#isPlayingAlarm) {
                this.#isPlayingAlarm = isInArea;
                mod.EnableSFX(this.#alarmSound, this.#isPlayingAlarm);
            }
            const progress = elapsedTime / this.settings.bombTimerDuration;
            const percentage = mod.Floor(progress * 100);
            let percentageUnder = mod.Floor(((progress * 100) % 1) * 10);
            if (percentageUnder >= 10) percentageUnder = 9; // fix for rounding error
            mod.SetWorldIconText(this.#worldIcon, mod.Message(mod.stringkeys.percentage, percentage, percentageUnder));
        }

        this.isAlive = false;
        mod.PlayVO(this.#voiceOver, mod.VoiceOverEvents2D.MComDestroyedFriendly, this.settings.voiceOverFlag);
        mod.EnableVFX(this.#areaEffect, false);
        mod.EnableSFX(this.#alarmSound, false);
        this.#Explode(armedPlayer);
        this.#UnspawnObjects();
    }

    #IsInAreaAnyPlayer(): boolean {
        const survivorTeam = mod.GetTeam(1);
        const allPlayers = mod.AllPlayers();
        const count = mod.CountOf(allPlayers);
        for (let i = 0; i < count; i++) {
            const player = mod.ValueInArray(allPlayers, i);
            if (mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)
                && mod.Equals(mod.GetTeam(player), survivorTeam)
                && mod.DistanceBetween(this.position, mod.GetObjectPosition(player)) < this.#areaRadius) {
                return true;
            }
        }
        return false;
    }

    #Explode(armedPlayer: mod.Player) {
        mod.EnableVFX(this.#explosionEffect, true);
        DamageUtility.Explode(armedPlayer, this.position, 20, 200);
        PlayerNotifications.PushToAll({
            message: mod.Message(mod.stringkeys.target_destroyed, armedPlayer, this.settings.nameKey),
            minDuration: 2,
            maxDuration: 5
        });
    }
}

class ZombieNestManager {
    static allNests: ZombieNest[] = [];

    static CreateNest(settings: ZombieNestSettings): ZombieNest {
        const nest = new ZombieNest(settings);
        this.allNests.push(nest);
        return nest;
    }
}

const voiceOverFlags: mod.VoiceOverFlags[] = [
    mod.VoiceOverFlags.Alpha,
    mod.VoiceOverFlags.Bravo,
    mod.VoiceOverFlags.Charlie,
    mod.VoiceOverFlags.Delta,
    mod.VoiceOverFlags.Echo,
    mod.VoiceOverFlags.Foxtrot,
    mod.VoiceOverFlags.Golf,
]

function GetVoiceOverFlag(index: number): mod.VoiceOverFlags {
    return index < voiceOverFlags.length ? voiceOverFlags[index] : voiceOverFlags[0];
}

class GameDirector {
    static targetZombieCount: number = 0;
    static #maxZombieSpawnCountEachNest = 15;
    static #spawnInterval: number = 8;
    static #outpostCount: number = 3;
    static #outpostStart: number = 0.3;
    static #outpostEnd: number = 0.7;
    static isActive: boolean = true;
    static #coreNest: ZombieNest | undefined;

    static Setup(): void {
        void this.#PlaySetupSequence();
    }

    static async #PlaySetupSequence() {
        await this.#CreateNests();
        void this.#RepeatCalcTargetZombieCount();
        void this.#RepeatSpawn();
        void this.#RepeatRuleCheck();
    }

    static async #CreateNests() {
        const fieldStart = mod.GetObjectPosition(mod.GetHQ(1));
        const fieldEnd = mod.GetObjectPosition(mod.GetHQ(2));
        // Core
        {
            const result = await this.#DetectGround(fieldEnd);
            this.#coreNest = ZombieNestManager.CreateNest({
                nameKey: mod.stringkeys.main_target,
                position: result.position,
                orientation: result.orientation,
                isShowTargetText: true,
                bombTimerDuration: 30,
                voiceOverFlag: GetVoiceOverFlag(this.#outpostCount),
            });
        }

        // Outposts
        const lineDirection = mod.Normalize(mod.Subtract(fieldEnd, fieldStart));
        const lineWidthMin = 8;
        const lineWidthMax = 100;
        const lineWidthMargin = 2;
        const lineRight = mod.DirectionFromAngles(mod.AngleBetweenVectors(mod.ForwardVector(), lineDirection) + 90, 0);
        for (let i = 0; i < this.#outpostCount; i++) {
            const t = i / (this.#outpostCount - 1);
            const lineT = this.#outpostStart + (this.#outpostEnd - this.#outpostStart) * t;
            const midPoint = LerpVector(fieldStart, fieldEnd, lineT);
            const sideWalls = await this.#DetectSideWall(mod.Add(midPoint, mod.Multiply(mod.UpVector(), 5)), lineRight, lineWidthMin / 2, lineWidthMax / 2, lineWidthMargin);
            const randomPoint = LerpVector(sideWalls.left, sideWalls.right, mod.RandomReal(0, 1));
            const result = await this.#DetectGround(randomPoint);
            ZombieNestManager.CreateNest({
                nameKey: mod.stringkeys.sub_target,
                position: result.position,
                orientation: result.orientation,
                isShowTargetText: false,
                bombTimerDuration: 10,
                voiceOverFlag: GetVoiceOverFlag(i),
            });
        }
    }

    static async #DetectSideWall(position: mod.Vector, rightDirection: mod.Vector, minDistance: number, maxDistance: number, margin: number): Promise<{
        left: mod.Vector,
        right: mod.Vector
    }> {
        // Left
        const leftDirection = mod.Multiply(rightDirection, -1);
        const leftResult = await Raycaster.Raycast(position, leftDirection, maxDistance);
        const leftDistance = leftResult.isHit ? mod.Max(mod.DistanceBetween(position, leftResult.hitPosition) - margin, minDistance) : maxDistance;
        const leftPosition = mod.Add(position, mod.Multiply(leftDirection, leftDistance));
        // Right
        const rightResult = await Raycaster.Raycast(position, rightDirection, maxDistance);
        const rightDistance = rightResult.isHit ? mod.Max(mod.DistanceBetween(position, rightResult.hitPosition) - margin, minDistance) : maxDistance;
        const rightPosition = mod.Add(position, mod.Multiply(rightDirection, rightDistance));
        return {left: leftPosition, right: rightPosition}
    }

    static async #DetectGround(position: mod.Vector): Promise<{ position: mod.Vector, orientation: number }> {
        const startHeight = 10;
        const distance = 100;
        const checkCount = 8;
        const hitPositions: mod.Vector[] = [];

        // Center
        {
            const raycastResult = await Raycaster.Raycast(mod.Add(position, mod.Multiply(mod.UpVector(), startHeight)), mod.DownVector(), distance);
            if (raycastResult.isHit) hitPositions.push(raycastResult.hitPosition);
        }

        // Around
        const angleOffset = mod.RandomReal(0, 360);
        const radius = 1;
        for (let i = 0; i < checkCount; i++) {
            const angle = angleOffset + (360 / checkCount) * i;
            const direction = mod.DirectionFromAngles(angle, 0);
            const aroundPos = mod.Add(position, mod.Multiply(direction, radius));
            const raycastResult = await Raycaster.Raycast(mod.Add(aroundPos, mod.Multiply(mod.UpVector(), startHeight)), mod.DownVector(), distance);
            if (raycastResult.isHit) hitPositions.push(raycastResult.hitPosition);
        }

        if (hitPositions.length == 0) {
            return {position: position, orientation: 0};
        }

        let totalY = 0;
        for (const hitPosition of hitPositions) {
            totalY += mod.YComponentOf(hitPosition);
        }
        const averageY = totalY / hitPositions.length;

        let closestAveragePosition = hitPositions[0];
        let closestAverageDistance = Infinity;
        for (const hitPosition of hitPositions) {
            const dist = mod.AbsoluteValue(averageY - mod.YComponentOf(hitPosition));
            if (dist < closestAverageDistance) {
                closestAveragePosition = hitPosition;
                closestAverageDistance = dist;
            }
        }

        let hightestPosition = hitPositions[0];
        let hightestY = -Infinity;
        let lowestPosition = hitPositions[0];
        let lowestY = Infinity;
        for (const hitPosition of hitPositions) {
            const y = mod.YComponentOf(hitPosition);
            if (y > hightestY) {
                hightestPosition = hitPosition;
                hightestY = y;
            }

            if (y < lowestY) {
                lowestPosition = hitPosition;
                lowestY = y;
            }
        }

        let diff = mod.Subtract(lowestPosition, hightestPosition);
        let direction = mod.Normalize(mod.CreateVector(mod.XComponentOf(diff), 0, mod.ZComponentOf(diff)));
        let angle = mod.AngleBetweenVectors(mod.ForwardVector(), direction);
        return {position: closestAveragePosition, orientation: mod.DegreesToRadians(angle)};
    }

    static async #RepeatCalcTargetZombieCount() {
        // Fixed starting wave
        this.targetZombieCount = 80;
        await mod.Wait(30);

        // Wave
        const interval = 15;
        while (this.isActive) {
            this.targetZombieCount = mod.Floor(mod.RandomReal(30, 50));
            await mod.Wait(interval);
            this.targetZombieCount = 80;
            await mod.Wait(interval);
        }
    }

    static async #RepeatSpawn() {
        while (this.isActive) {
            this.#SpawnZombies();
            await mod.Wait(this.#spawnInterval);
        }
    }

    static #SpawnZombies() {
        const totalZombieCount = AISpawner.GetWaitingCount() + ZombieManager.GetInstanceCount();
        const aliveNestCount = ZombieNestManager.allNests.filter(nest => nest.isAlive).length;
        if (aliveNestCount > 0) {
            const totalSpawnCount = this.targetZombieCount - totalZombieCount;
            if (totalSpawnCount > 0) {
                const spawnCountEachNest = Math.min(mod.Floor(totalSpawnCount / aliveNestCount), this.#maxZombieSpawnCountEachNest);
                DebugBoard.Set(4, totalSpawnCount);
                DebugBoard.Set(5, aliveNestCount);
                DebugBoard.Set(6, spawnCountEachNest);
                if (spawnCountEachNest > 0) {
                    for (const nest of ZombieNestManager.allNests) {
                        if (nest.isAlive) {
                            nest.Spawn(spawnCountEachNest);
                        }
                    }
                }
            }
        }
    }

    static async #RepeatRuleCheck() {
        const tick = 1 / 30;
        while (this.isActive) {
            await mod.Wait(tick);
            if (this.#coreNest && !this.#coreNest.isAlive) {
                this.isActive = false;
                void this.#PlayVictory();
                return;
            }
        }
    }

    static async #PlayVictory() {
        mod.EndGameMode(mod.GetTeam(1));
    }
}

class DamageUtility {
    static Explode(attacker: mod.Player, position: mod.Vector, radius: number, damage: number) {
        const team = mod.GetTeam(attacker);
        const allPlayers = mod.AllPlayers();
        const count = mod.CountOf(allPlayers);
        for (let i = 0; i < count; i++) {
            const player = mod.ValueInArray(allPlayers, i);
            if (player
                && mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)
                && mod.NotEqualTo(team, mod.GetTeam(player))) {
                const distance = mod.DistanceBetween(position, mod.GetObjectPosition(player));
                if (distance < radius) {
                    mod.DealDamage(player, damage, attacker);
                }
            }
        }
    }
}

class ZombiePenalty {
    static hqSafetyRadius: number = 8;
    static speedThreshold: number = 0.01;
    static penaltyDecreaseRate: number = 0.5;
    static penaltyKillThreshold: number = 10;

    static isEnabled: boolean = true;

    static Setup() {
        void this.#RepeatCheck();
    }

    static async #RepeatCheck() {
        const interval = 1 / 30;
        const hqPosition = mod.GetObjectPosition(mod.GetHQ(1));
        while (this.isEnabled) {
            await mod.Wait(interval);
            const zombies = ZombieManager.allZombies.values();
            for (const zombie of zombies) {
                let additionalPenalty = 0;

                // Teleport zombies in HQ
                const zombiePosition = mod.GetObjectPosition(zombie.player);
                const hqDistance = mod.DistanceBetween(hqPosition, zombiePosition);
                if (hqDistance < this.hqSafetyRadius) {
                    const dir = mod.DirectionTowards(hqPosition, zombiePosition);
                    let farPos = mod.Add(hqPosition, mod.Multiply(dir, this.hqSafetyRadius + 0.1));
                    farPos = mod.CreateVector(mod.XComponentOf(farPos), mod.YComponentOf(zombiePosition), mod.ZComponentOf(farPos));
                    const faceDir = mod.GetSoldierState(zombie.player, mod.SoldierStateVector.GetFacingDirection);
                    const rad = Math.atan2(mod.XComponentOf(faceDir), mod.ZComponentOf(faceDir));
                    mod.Teleport(zombie.player, farPos, rad);
                    additionalPenalty += interval * 10;
                }

                // Speed penalty
                const velocity = mod.GetSoldierState(zombie.player, mod.SoldierStateVector.GetLinearVelocity);
                const speed = mod.DistanceBetween(zeroVector, velocity);
                if (speed < this.speedThreshold) {
                    additionalPenalty += interval;
                }

                zombie.penaltyStack += additionalPenalty;
                if (additionalPenalty == 0) {
                    zombie.penaltyStack -= interval * this.penaltyDecreaseRate;
                }

                zombie.penaltyStack = Math.max(0, zombie.penaltyStack);

                // Kill
                if (zombie.penaltyStack > this.penaltyKillThreshold) {
                    mod.Kill(zombie.player);
                }
            }
        }
    }
}

class SurvivorModifier {
    static OnDeployed(player: mod.Player) {
        void this.#LookToEnemyBaseWithDelay(player);
    }

    static async #LookToEnemyBaseWithDelay(player: mod.Player) {
        await mod.Wait(0.1);
        const position = mod.GetObjectPosition(player);
        const dir = mod.DirectionTowards(position, mod.GetObjectPosition(mod.GetHQ(2)));
        const rad = Math.atan2(mod.XComponentOf(dir), mod.ZComponentOf(dir));
        mod.Teleport(player, position, rad);
    }
}

//
// UI
//

type NotificationContent = {
    message: mod.Message;
    minDuration: number;
    maxDuration: number;
}

class Notification {
    #text: mod.UIWidget;
    #contentsQueue: NotificationContent[] = [];
    #isPlaying: boolean = false;
    static #emptyMessage: mod.Message = mod.Message(0);

    constructor(receiver: mod.Player | mod.Team) {
        const textName = UniqueID.GetString();
        mod.AddUIText(
            textName,
            mod.CreateVector(0, 200, 0),
            mod.CreateVector(1000, 100, 0),
            mod.UIAnchor.TopCenter,
            Notification.#emptyMessage,
            receiver
        );
        this.#text = mod.FindUIWidgetWithName(textName);
        mod.SetUIWidgetBgColor(this.#text, mod.CreateVector(0, 0, 0));
        //mod.SetUIWidgetBgAlpha(this.#text, 0.5);
        mod.SetUIWidgetBgFill(this.#text, mod.UIBgFill.Blur);
        mod.SetUITextColor(this.#text, mod.CreateVector(1, 1, 1));
        mod.SetUITextAnchor(this.#text, mod.UIAnchor.Center);
        mod.SetUIWidgetVisible(this.#text, false);
    }

    Dispose() {
        if (this.#text) mod.DeleteUIWidget(this.#text);
    }

    Push(content: NotificationContent) {
        this.#contentsQueue.push(content);
        this.#TryPlayNext();
    }

    #TryPlayNext() {
        if (!this.#isPlaying) {
            const content = this.#contentsQueue.shift();
            if (content) {
                void this.PlayNotification(content);
            }
        }
    }

    async PlayNotification(content: NotificationContent) {
        this.#isPlaying = true;
        try {
            const tick = 1 / 60;
            await mod.Wait(tick); // Wait for the UI to be updated.
            mod.SetUITextLabel(this.#text, content.message);
            mod.SetUIWidgetVisible(this.#text, true);
            let elapsedTime = 0;
            while (true) {
                await mod.Wait(tick);
                elapsedTime += tick;
                const duration = this.#contentsQueue.length > 0 ? content.minDuration : content.maxDuration;
                if (elapsedTime > duration) {
                    break;
                }
            }

            mod.SetUIWidgetVisible(this.#text, false);
            await mod.Wait(tick); // Wait for the UI to be updated.
        } finally {
            this.#isPlaying = false;
        }

        this.#TryPlayNext();
    }
}

class PlayerNotifications {
    static #notifications: Map<number, Notification> = new Map();

    static Create(player: mod.Player): Notification {
        const playerId = mod.GetObjId(player);
        const notification = new Notification(player);
        this.#notifications.set(playerId, notification);
        return notification;
    }

    static Destroy(playerId: number) {
        const notification = this.#notifications.get(playerId);
        if (notification) {
            notification.Dispose();
            this.#notifications.delete(playerId);
        }
    }

    static Get(player: mod.Player): Notification | undefined {
        const playerId = mod.GetObjId(player);
        return this.#notifications.get(playerId);
    }

    static PushToAll(content: NotificationContent) {
        for (const [_, notification] of this.#notifications) {
            notification.Push(content);
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

function FindClosestPlayer(position: mod.Vector, team: mod.Team): mod.Player | undefined {
    const players = mod.AllPlayers();
    let closestPlayer: mod.Player | undefined;
    let closestDistance = Infinity;
    const playerCount = mod.CountOf(players);
    for (let i = 0; i < playerCount; i++) {
        const player = mod.ValueInArray(players, i);
        if (!player
            || mod.GetObjId(player) < 0
            || !mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)
            || mod.NotEqualTo(mod.GetTeam(player), team)) {
            continue;
        }

        let distance = SqrMagnitudeXZ(mod.Subtract(position, mod.GetObjectPosition(player)));
        if (distance < closestDistance && mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive) && mod.Equals(mod.GetTeam(player), team)) {
            closestPlayer = player;
            closestDistance = distance;
        }
    }

    return closestPlayer;
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

//
// Debugs
//

function DebugLog(message: mod.Message, isError: boolean = false) {
    if (isError) {
        mod.SendErrorReport(message);
    }

    if (enableDebug) {
        mod.DisplayHighlightedWorldLogMessage(message);
        mod.DisplayNotificationMessage(message)
    }
}

class DebugBoard {
    key: number;
    #text: mod.UIWidget;
    static #height: number = 50;

    constructor(key: number, value: number) {
        this.key = key;
        const textName = UniqueID.GetString();
        mod.AddUIText(
            textName,
            mod.CreateVector(10, 10 + this.key * DebugBoard.#height, 0),
            mod.CreateVector(200, 50, 0),
            mod.UIAnchor.TopCenter,
            mod.Message(mod.stringkeys.dbg_board, key, value)
        );
        this.#text = mod.FindUIWidgetWithName(textName);
        mod.SetUIWidgetAnchor(this.#text, mod.UIAnchor.TopLeft);
        mod.SetUITextAnchor(this.#text, mod.UIAnchor.CenterLeft);
    }

    SetValue(value: number) {
        mod.SetUITextLabel(this.#text, mod.Message(mod.stringkeys.dbg_board, this.key, value));
    }

    static #elements: Map<number, DebugBoard> = new Map();

    static Set(key: number, value: number) {
        if (!enableDebug) {
            return;
        }

        const element = this.#elements.get(key)
        if (element) {
            element.SetValue(value);
        } else {
            const element = new DebugBoard(key, value);
            this.#elements.set(key, element);
        }
    }
}
