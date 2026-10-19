//! Which game is running, for the "Playing" activity others see. Only the game's name leaves this
//! module; process lists and paths stay on the computer.
//!
//! A program counts as a game when the user added it, when it is on a short built-in list, or when
//! it runs from a game library folder (Steam, Epic Games, Xbox), named after that folder.

use serde::{Deserialize, Serialize};

/// A program the user marked as a game.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomGame {
    /// File name of the program, such as `MyGame.exe` (compared without case).
    pub exe: String,
    pub name: String,
}

/// A running program the user can pick when adding a game.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct RunningProgram {
    pub exe: String,
    /// The game name Ovrilo would show for it, if it recognises it already.
    pub detected: Option<String>,
}

/// Popular games often installed outside the library folders below (our own list).
const KNOWN_GAMES: &[(&str, &str)] = &[
    ("valorant-win64-shipping.exe", "VALORANT"),
    ("league of legends.exe", "League of Legends"),
    // The client (lobby, champion select) runs before and between matches.
    ("leagueclient.exe", "League of Legends"),
    ("cs2.exe", "Counter-Strike 2"),
    ("fortniteclient-win64-shipping.exe", "Fortnite"),
    ("r5apex.exe", "Apex Legends"),
    ("r5apex_dx12.exe", "Apex Legends"),
    ("overwatch.exe", "Overwatch 2"),
    ("gta5.exe", "Grand Theft Auto V"),
    ("rocketleague.exe", "Rocket League"),
    ("dota2.exe", "Dota 2"),
    ("minecraft.windows.exe", "Minecraft"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("rainbowsix.exe", "Rainbow Six Siege"),
    ("eldenring.exe", "ELDEN RING"),
    ("wow.exe", "World of Warcraft"),
    ("hearthstone.exe", "Hearthstone"),
    ("diablo iv.exe", "Diablo IV"),
    ("tslgame.exe", "PUBG: BATTLEGROUNDS"),
    ("rustclient.exe", "Rust"),
    ("destiny2.exe", "Destiny 2"),
    ("escapefromtarkov.exe", "Escape from Tarkov"),
    ("osu!.exe", "osu!"),
    ("genshinimpact.exe", "Genshin Impact"),
    ("helldivers2.exe", "HELLDIVERS 2"),
    ("witcher3.exe", "The Witcher 3"),
    ("cyberpunk2077.exe", "Cyberpunk 2077"),
    ("bg3.exe", "Baldur's Gate 3"),
    ("bg3_dx11.exe", "Baldur's Gate 3"),
    ("palworld-win64-shipping.exe", "Palworld"),
    ("deadbydaylight-win64-shipping.exe", "Dead by Daylight"),
    ("among us.exe", "Among Us"),
    ("terraria.exe", "Terraria"),
    ("stardew valley.exe", "Stardew Valley"),
];

/// Library folders whose next path segment is the game's folder, as found in its path (lowercase).
const LIBRARIES: &[&str] = &[r"\steamapps\common\", r"\epic games\", r"\xboxgames\"];

/// Folders inside libraries that hold tools, not games.
const NOT_GAME_FOLDERS: &[&str] = &[
    "launcher",
    "steamworks shared",
    "directxredist",
    "epic online services",
];

/// Programs in a game's folder that are not the game itself.
const HELPER_PARTS: &[&str] = &[
    "crash",
    "report",
    "launcher",
    "helper",
    "setup",
    "unins",
    "redist",
    "easyanticheat",
    "battleye",
    "prereq",
    "dxsetup",
    "update",
    "installer",
    "overlay",
    "webhelper",
    "cefprocess",
];

/// The game a program is, from its full path and the user's own games, or None.
pub fn classify(path: &str, custom: &[CustomGame]) -> Option<String> {
    let exe = path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .to_lowercase();
    if let Some(game) = custom.iter().find(|g| g.exe.to_lowercase() == exe) {
        return Some(game.name.clone());
    }
    if let Some((_, name)) = KNOWN_GAMES.iter().find(|(known, _)| *known == exe) {
        return Some((*name).to_owned());
    }
    if HELPER_PARTS.iter().any(|part| exe.contains(part)) {
        return None;
    }

    // ASCII lowercasing keeps every byte offset, so the folder can be cut from the original path
    // with its own capitalisation.
    let lower = path.to_ascii_lowercase().replace('/', "\\");
    LIBRARIES.iter().find_map(|library| {
        let start = lower.find(library)? + library.len();
        let folder = path.get(start..)?.split(['\\', '/']).next()?.trim();
        let is_game =
            !folder.is_empty() && !NOT_GAME_FOLDERS.contains(&folder.to_ascii_lowercase().as_str());
        is_game.then(|| folder.to_owned())
    })
}

/// The first game found among the running programs.
#[tauri::command]
pub async fn games_detect(custom: Vec<CustomGame>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        running_paths()
            .iter()
            .find_map(|path| classify(path, &custom))
    })
    .await
    .ok()
    .flatten()
}

/// Running programs outside Windows' own folders, for adding one as a game.
#[tauri::command]
pub async fn games_running_programs(custom: Vec<CustomGame>) -> Vec<RunningProgram> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut programs: Vec<RunningProgram> = running_paths()
            .iter()
            .filter(|path| !path.to_lowercase().starts_with(r"c:\windows\"))
            .filter_map(|path| {
                let exe = path.rsplit(['\\', '/']).next()?.to_owned();
                Some(RunningProgram {
                    detected: classify(path, &custom),
                    exe,
                })
            })
            .collect();
        programs.sort();
        programs.dedup_by(|a, b| a.exe.eq_ignore_ascii_case(&b.exe));
        programs
    })
    .await
    .unwrap_or_default()
}

/// Full paths of the running processes this user may query.
///
/// The process list comes from a snapshot that needs no access to the processes themselves. Each
/// process is opened (query-only, briefly) once, the first time it is seen: a running game is not
/// touched again on later checks, which keeps anti-cheat software from seeing repeated access.
#[cfg(windows)]
fn running_paths() -> Vec<String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, PoisonError};

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };

    /// Path per process, keyed by ID and file name (IDs are reused after a process exits).
    type Paths = HashMap<(u32, String), Option<String>>;
    static KNOWN: Mutex<Option<Paths>> = Mutex::new(None);

    // SAFETY: plain Win32 calls; the snapshot handle is closed below, and the entry buffer is
    // valid for the size given.
    let running: Vec<(u32, String)> = unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut running = Vec::new();
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let length = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            running.push((
                entry.th32ProcessID,
                String::from_utf16_lossy(&entry.szExeFile[..length]),
            ));
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        running
    };

    let mut guard = KNOWN.lock().unwrap_or_else(PoisonError::into_inner);
    let known = guard.get_or_insert_with(HashMap::new);
    let mut current = HashMap::with_capacity(running.len());
    for key in running {
        let path = known.remove(&key).unwrap_or_else(|| {
            // SAFETY: the handle is checked and closed; the buffer is valid for `length` units.
            unsafe {
                let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, key.0);
                if process.is_null() {
                    return None;
                }
                let mut buffer = [0u16; 1024];
                let mut length = buffer.len() as u32;
                let ok = QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    buffer.as_mut_ptr(),
                    &mut length,
                ) != 0;
                CloseHandle(process);
                ok.then(|| String::from_utf16_lossy(&buffer[..length as usize]))
            }
        });
        current.insert(key, path);
    }
    // Processes that exited drop out here.
    *known = current;
    known.values().flatten().cloned().collect()
}

#[cfg(not(windows))]
fn running_paths() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(path: &str) -> Option<String> {
        classify(path, &[])
    }

    /// Manual check on a real computer: `cargo test --lib games -- --ignored --nocapture`.
    #[test]
    #[ignore = "depends on the programs running on this computer"]
    fn prints_the_games_running_now() {
        let games: Vec<String> = running_paths()
            .iter()
            .filter_map(|p| classify(p, &[]))
            .collect();
        println!("{} processes, games: {games:?}", running_paths().len());
    }

    /// Manual timing: `cargo test --release --lib games::tests::times_a_scan -- --ignored --nocapture`.
    #[test]
    #[ignore = "timing on this computer"]
    fn times_a_scan() {
        let first = std::time::Instant::now();
        let count = running_paths().len();
        let first = first.elapsed();
        let later = std::time::Instant::now();
        for _ in 0..20 {
            let _ = running_paths()
                .iter()
                .filter_map(|p| classify(p, &[]))
                .count();
        }
        println!(
            "{count} processes; first scan {first:?}; later scans {:?} each",
            later.elapsed() / 20
        );
    }

    #[test]
    fn library_folders_name_the_game() {
        assert_eq!(
            game(r"D:\SteamLibrary\steamapps\common\Hollow Knight\hollow_knight.exe").as_deref(),
            Some("Hollow Knight")
        );
        assert_eq!(
            game(r"C:\Program Files\Epic Games\Satisfactory\FactoryGame.exe").as_deref(),
            Some("Satisfactory")
        );
        assert_eq!(
            game(r"C:\XboxGames\Forza Horizon 5\Content\ForzaHorizon5.exe").as_deref(),
            Some("Forza Horizon 5")
        );
    }

    #[test]
    fn helpers_launchers_and_tools_are_not_games() {
        assert_eq!(
            game(r"C:\Program Files (x86)\Steam\steamapps\common\Rust\UnityCrashHandler64.exe"),
            None
        );
        assert_eq!(
            game(
                r"C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
            ),
            None
        );
        assert_eq!(
            game(r"D:\steamapps\common\Steamworks Shared\_CommonRedist\vcredist\vc_redist.x64.exe"),
            None
        );
        assert_eq!(game(r"C:\Program Files\Discord\Discord.exe"), None);
        assert_eq!(game(r"C:\Windows\System32\svchost.exe"), None);
    }

    #[test]
    fn known_games_anywhere_and_custom_games_first() {
        assert_eq!(
            game(r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe").as_deref(),
            Some("VALORANT")
        );
        assert_eq!(
            game(r"C:\Riot Games\League of Legends\LeagueClient.exe").as_deref(),
            Some("League of Legends")
        );
        let custom = [CustomGame {
            exe: "Notepad++.exe".into(),
            name: "Writing".into(),
        }];
        assert_eq!(
            classify(r"C:\Program Files\Notepad++\notepad++.exe", &custom).as_deref(),
            Some("Writing")
        );
        // A custom name wins over the built-in one.
        let renamed = [CustomGame {
            exe: "cs2.exe".into(),
            name: "CS".into(),
        }];
        assert_eq!(
            classify(r"D:\Games\cs2.exe", &renamed).as_deref(),
            Some("CS")
        );
    }
}
