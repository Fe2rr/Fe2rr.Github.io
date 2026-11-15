/*
 * Commercial SoC mapping, model name normalization (RAM/storage deduplication),
 * and curated Android handheld catalog for NAPL.
 */

export const ANDROID_HANDHELDS = [
    { manufacturer: "AYN", model: "Thor", soc: "Snapdragon 8 Gen 2" },
    { manufacturer: "AYN", model: "Thor Lite", soc: "Snapdragon 865" },
    { manufacturer: "AYN", model: "Odin 2", soc: "Snapdragon 8 Gen 2" },
    { manufacturer: "AYN", model: "Odin 2 Mini", soc: "Snapdragon 8 Gen 2" },
    { manufacturer: "AYN", model: "Odin 2 Portal", soc: "Snapdragon 8 Gen 2" },
    { manufacturer: "AYN", model: "Odin 3", soc: "Snapdragon 8 Elite" },
    { manufacturer: "AYN", model: "Odin 3 Portal", soc: "Snapdragon 8 Elite" },

    { manufacturer: "Retroid", model: "Pocket 5", soc: "Snapdragon 865" },
    { manufacturer: "Retroid", model: "Pocket 6", soc: "Snapdragon 8 Gen 2" },
    { manufacturer: "Retroid", model: "Pocket Mini", soc: "Snapdragon 865" },
    { manufacturer: "Retroid", model: "Pocket Mini V2", soc: "Snapdragon 865" },
    { manufacturer: "Retroid", model: "Pocket Flip 2", soc: "Snapdragon 865" },
    { manufacturer: "Retroid", model: "Pocket Duo", soc: "Snapdragon 865" },
    { manufacturer: "Retroid", model: "Pocket 4 Pro", soc: "MediaTek Dimensity 1100" },
    { manufacturer: "Retroid", model: "Pocket 4", soc: "MediaTek Dimensity 900" },
    { manufacturer: "Retroid", model: "Pocket 3+", soc: "Unisoc T618" },
    { manufacturer: "Retroid", model: "Pocket 3", soc: "Unisoc T310" },
    { manufacturer: "Retroid", model: "Pocket 2S", soc: "Unisoc T610" },

    { manufacturer: "AYANEO", model: "Pocket EVO", soc: "Snapdragon G3x Gen 2" },
    { manufacturer: "AYANEO", model: "Pocket S", soc: "Snapdragon G3x Gen 2" },
    { manufacturer: "AYANEO", model: "Pocket S2", soc: "Snapdragon G3 Gen 3" },
    { manufacturer: "AYANEO", model: "Pocket ACE", soc: "Snapdragon G3x Gen 2" },
    { manufacturer: "AYANEO", model: "Pocket DS", soc: "Snapdragon G3x Gen 2" },
    { manufacturer: "AYANEO", model: "Pocket DMG", soc: "Snapdragon G3x Gen 2" },
    { manufacturer: "AYANEO", model: "Pocket MICRO", soc: "MediaTek Helio G99" },
    { manufacturer: "AYANEO", model: "Pocket MICRO 2", soc: "MediaTek Dimensity 7050" },

    { manufacturer: "KONKR", model: "Pocket FIT (8 Elite)", soc: "Snapdragon 8 Elite" },
    { manufacturer: "KONKR", model: "Pocket FIT (G3 Gen 3)", soc: "Snapdragon G3 Gen 3" },

    { manufacturer: "MANGMI", model: "AIR Y Pro", soc: "Snapdragon 8 Gen 2" },
    { manufacturer: "MANGMI", model: "Pocket Max", soc: "MediaTek Dimensity 8300" },

    { manufacturer: "Anbernic", model: "RG353V", soc: "Rockchip RK3566" },
    { manufacturer: "Anbernic", model: "RG353M", soc: "Rockchip RK3566" },
    { manufacturer: "Anbernic", model: "RG353P", soc: "Rockchip RK3566" },
    { manufacturer: "Anbernic", model: "RG552", soc: "Rockchip RK3399" },
    { manufacturer: "Anbernic", model: "RG505", soc: "Unisoc T618" },
    { manufacturer: "Anbernic", model: "RG405V", soc: "Unisoc T618" },
    { manufacturer: "Anbernic", model: "RG405M", soc: "Unisoc T618" },
    { manufacturer: "Anbernic", model: "RG556", soc: "Unisoc T820" },
    { manufacturer: "Anbernic", model: "RG Cube", soc: "Unisoc T820" },
    { manufacturer: "Anbernic", model: "RG406V", soc: "Unisoc T820" },
    { manufacturer: "Anbernic", model: "RG406H", soc: "Unisoc T820" },
    { manufacturer: "Anbernic", model: "RG557", soc: "MediaTek Dimensity 8300" },
    { manufacturer: "Anbernic", model: "RG DS", soc: "Rockchip RK3568" },

    { manufacturer: "Powkiddy", model: "X18S", soc: "Unisoc T618" },
    { manufacturer: "Powkiddy", model: "X28", soc: "Unisoc T618" },
    { manufacturer: "Powkiddy", model: "RGB10 Max 3 Pro", soc: "Amlogic A311D" },
    { manufacturer: "GPD", model: "XP", soc: "MediaTek Helio G95" },
    { manufacturer: "GPD", model: "XP Plus", soc: "MediaTek Dimensity 1200" },
    { manufacturer: "Logitech", model: "G Cloud", soc: "Snapdragon 720G" },
    { manufacturer: "Abxylute", model: "One", soc: "MediaTek MT8365" },
    { manufacturer: "KT", model: "KT-R1", soc: "MediaTek Helio G99" },
    { manufacturer: "Pimax", model: "Portal", soc: "Snapdragon XR2" },
    { manufacturer: "ZPG", model: "A1 Unicorn", soc: "MediaTek Helio G99" },
    { manufacturer: "MOQI", model: "i7S", soc: "Snapdragon 710" },
    { manufacturer: "TJD", model: "T80", soc: "Rockchip RK3588" },
    { manufacturer: "Razer", model: "Edge", soc: "Snapdragon G3x Gen 1" },
];

// Exact/base code -> Commercial SoC name mapping
const SOC_CODE_MAP = {
    // --- Qualcomm / QTI Snapdragon Flagships & 8-series ---
    "SM8975": "Snapdragon 8 Elite Extreme Gen 6",
    "SM8950": "Snapdragon 8 Elite Gen 6",
    "SM8850": "Snapdragon 8 Elite Gen 5",
    "SM8850P": "Snapdragon 8 Elite Gen 5",
    "SM8845": "Snapdragon 8 Gen 5",
    "SM8750": "Snapdragon 8 Elite",
    "SM8735": "Snapdragon 8s Gen 4",
    "SM8735P": "Snapdragon 8s Gen 4",
    "SM8650": "Snapdragon 8 Gen 3",
    "SM8650Q": "Snapdragon 8 Gen 3",
    "SM8635": "Snapdragon 8s Gen 3",
    "SM8550": "Snapdragon 8 Gen 2",
    "SM8475": "Snapdragon 8+ Gen 1",
    "SM8450": "Snapdragon 8 Gen 1",
    "SM8350": "Snapdragon 888",
    "SM8250": "Snapdragon 865",
    "SM8250AC": "Snapdragon 870",
    "SM8250PRO": "Snapdragon 865+",
    "SM8150": "Snapdragon 855",
    "SM8150P": "Snapdragon 855+",
    "SDM855": "Snapdragon 855",
    "SDM845": "Snapdragon 845",
    "SDM835": "Snapdragon 835",
    "MSM8998": "Snapdragon 835",
    "MSM8996": "Snapdragon 820",
    "MSM8996PRO": "Snapdragon 821",
    "APQ8096": "Snapdragon 820",
    "MSM8994": "Snapdragon 810",
    "APQ8094": "Snapdragon 810",
    "MSM8992": "Snapdragon 808",
    "APQ8084": "Snapdragon 805",
    "APQ8084AB": "Snapdragon 805",
    "MSM8974": "Snapdragon 800",
    "MSM8974AA": "Snapdragon 800",
    "MSM8974AB": "Snapdragon 801",
    "MSM8974AC": "Snapdragon 801",
    "APQ8074": "Snapdragon 800",
    "APQ8074AB": "Snapdragon 801",
    "MSM8674": "Snapdragon 800",
    "SG8175P": "Snapdragon G3x Gen 1",
    "SXR1130": "Snapdragon XR1",

    // --- Qualcomm / QTI Snapdragon 7-series ---
    "SM7750": "Snapdragon 7 Gen 4",
    "SM7675": "Snapdragon 7+ Gen 3",
    "SM7635": "Snapdragon 7s Gen 3",
    "SM7550": "Snapdragon 7 Gen 3",
    "SM7475": "Snapdragon 7+ Gen 2",
    "SM7450": "Snapdragon 7 Gen 1",
    "SM7435": "Snapdragon 7s Gen 2",
    "SM7350": "Snapdragon 780G",
    "SM7325": "Snapdragon 778G",
    "SM7250": "Snapdragon 765G",
    "SM7225": "Snapdragon 750G",
    "SM7150": "Snapdragon 730G",
    "SM7125": "Snapdragon 720G",
    "SDM712": "Snapdragon 712",
    "SDM710": "Snapdragon 710",

    // --- Qualcomm / QTI Snapdragon 6-series ---
    "SM6650": "Snapdragon 6 Gen 4",
    "SM6475": "Snapdragon 6 Gen 3",
    "SM6450": "Snapdragon 6 Gen 1",
    "SM6435": "Snapdragon 6s Gen 4",
    "SM6375": "Snapdragon 695",
    "SM6350": "Snapdragon 690",
    "SM6225": "Snapdragon 680",
    "SM6150": "Snapdragon 675",
    "SM6125": "Snapdragon 665",
    "SM6115": "Snapdragon 662",
    "QCM6690": "Qualcomm QCM6690",
    "QCS6690": "Qualcomm QCS6690",
    "QCM6490": "Snapdragon 778G (IoT)",
    "QCS6490": "Snapdragon 778G (IoT)",
    "QCM6125": "Snapdragon 665 (IoT)",
    "QCM5430": "Snapdragon 778G (QCM5430)",
    "QCS5430": "Snapdragon 778G (QCS5430)",
    "SDM675": "Snapdragon 675",
    "SDM670": "Snapdragon 670",
    "SDA670": "Snapdragon 670",
    "SDM660": "Snapdragon 660",
    "SDA660": "Snapdragon 660",
    "SDM636": "Snapdragon 636",
    "SDM632": "Snapdragon 632",
    "SDM630": "Snapdragon 630",
    "MSM8976": "Snapdragon 652",
    "MSM8976SG": "Snapdragon 653",
    "MSM8956": "Snapdragon 650",
    "APQ8076": "Snapdragon 652",
    "APQ8056": "Snapdragon 650",
    "MSM8953": "Snapdragon 625",
    "MSM8953 PRO": "Snapdragon 626",
    "APQ8053": "Snapdragon 625",
    "MSM8952": "Snapdragon 617",
    "APQ8052": "Snapdragon 617",
    "MSM8939": "Snapdragon 615",
    "APQ8039": "Snapdragon 615",
    "MSM8929": "Snapdragon 415",
    "APQ8064": "Snapdragon S4 Pro",
    "APQ8064T": "Snapdragon 600",
    "APQ8064AU": "Snapdragon 600",
    "APQ8060": "Snapdragon S3",

    // --- Qualcomm / QTI Snapdragon 4-series & 2-series ---
    "SM4850": "Snapdragon 4 Gen 5",
    "SM4635": "Snapdragon 4s Gen 2",
    "SM4450": "Snapdragon 4 Gen 2",
    "SM4450P": "Snapdragon 4 Gen 2",
    "SM4375": "Snapdragon 4 Gen 1",
    "SM4350": "Snapdragon 480",
    "SM4250": "Snapdragon 460",
    "QCM4490": "Snapdragon 4 Gen 2 (IoT)",
    "QCS4490": "Snapdragon 4 Gen 2 (IoT)",
    "QCM4325": "Snapdragon 460 (IoT)",
    "QCM4290": "Snapdragon 460 (IoT)",
    "QCS4290": "Snapdragon 460 (IoT)",
    "SDM450": "Snapdragon 450",
    "SDA450": "Snapdragon 450",
    "SDM439": "Snapdragon 439",
    "SDM435": "Snapdragon 435",
    "SDM429": "Snapdragon 429",
    "SDM427": "Snapdragon 427",
    "SDM425": "Snapdragon 425",
    "MSM8940": "Snapdragon 435",
    "MSM8937": "Snapdragon 430",
    "MSM8930": "Snapdragon S4 Plus",
    "MSM8930AB": "Snapdragon S4 Plus",
    "MSM8928": "Snapdragon 400",
    "MSM8926": "Snapdragon 400",
    "MSM8228": "Snapdragon 400",
    "MSM8227": "Snapdragon S4 Plus",
    "MSM8226": "Snapdragon 400",
    "MSM8626": "Snapdragon 400",
    "MSM8X26": "Snapdragon 400",
    "MSM8X28": "Snapdragon 400",
    "MSM8230": "Snapdragon S4 Plus",
    "MSM8230AB": "Snapdragon S4 Plus",
    "MSM8239": "Snapdragon 615",
    "MSM8960": "Snapdragon S4 Plus",
    "MSM8260": "Snapdragon S3",
    "MSM8260A": "Snapdragon S4 Plus",
    "MSM8660": "Snapdragon S3",
    "MSM8920": "Snapdragon 427",
    "MSM8917": "Snapdragon 425",
    "APQ8017": "Snapdragon 425",
    "MSM8916": "Snapdragon 410",
    "MSM8216": "Snapdragon 410",
    "APQ8016": "Snapdragon 410",
    "APQ8026": "Snapdragon 400",
    "MSM8909": "Snapdragon 210",
    "APQ8009": "Snapdragon 210",
    "MSM8209": "Snapdragon 210",
    "MSM8212": "Snapdragon 200",
    "MSM8210": "Snapdragon 200",
    "MSM8610": "Snapdragon 200",
    "MSM8225": "Snapdragon S4 Play",
    "MSM8225Q": "Snapdragon S4 Play",
    "MSM8625Q": "Snapdragon S4 Play",
    "MSM7227A": "Snapdragon S1",
    "MSM7225A": "Snapdragon S1",
    "MSM7225AB": "Snapdragon S1",
    "QM215": "Snapdragon 215",
    "QCM2150": "Snapdragon 215",
    "QCM2290": "Qualcomm 2290",
    "QCS2290": "Qualcomm 2290",

    // --- MediaTek Dimensity / Helio / Kompanio ---
    "MT6983": "MediaTek Dimensity 9000",
    "MT6899": "MediaTek Dimensity 8400",
    "MT6897": "MediaTek Dimensity 8300",
    "MT6896": "MediaTek Dimensity 8200",
    "MT6896Z/CZA": "MediaTek Dimensity 8200",
    "MT6895": "MediaTek Dimensity 8100",
    "MT6895Z/TCZA": "MediaTek Dimensity 8100",
    "MT6895Z_B/TCZA": "MediaTek Dimensity 8100-Ultra",
    "MT6893": "MediaTek Dimensity 1200",
    "MT6893Z/CZA": "MediaTek Dimensity 1200",
    "MT6891": "MediaTek Dimensity 1100",
    "MT6891Z/CZA": "MediaTek Dimensity 1100",
    "MT6889": "MediaTek Dimensity 1000+",
    "MT6886": "MediaTek Dimensity 7200",
    "MT6885": "MediaTek Dimensity 1000L",
    "MT6883": "MediaTek Dimensity 800C",
    "MT6881": "MediaTek Dimensity 7500",
    "MT6879": "MediaTek Dimensity 1050",
    "MT6879V/ZA": "MediaTek Dimensity 1050",
    "MT6879V_T/ZA": "MediaTek Dimensity 7030",
    "MT6878": "MediaTek Dimensity 7300",
    "MT6877": "MediaTek Dimensity 900",
    "MT6877V/ZA": "MediaTek Dimensity 900",
    "MT6877V/TZA": "MediaTek Dimensity 920",
    "MT6877V/TTZA": "MediaTek Dimensity 1080",
    "MT6875": "MediaTek Dimensity 820",
    "MT6873": "MediaTek Dimensity 800",
    "MT6858": "MediaTek Dimensity 7030",
    "MT6855": "MediaTek Dimensity 930",
    "MT6855V/AZA": "MediaTek Dimensity 7020",
    "MT6853": "MediaTek Dimensity 720",
    "MT6853T": "MediaTek Dimensity 800U",
    "MT6853V/ZA": "MediaTek Dimensity 720",
    "MT6853V/NZA": "MediaTek Dimensity 720",
    "MT6853V/TNZA": "MediaTek Dimensity 800U",
    "MT6835": "MediaTek Dimensity 6080",
    "MT6835V/TZ": "MediaTek Dimensity 6300",
    "MT6835V/ZA": "MediaTek Dimensity 6080",
    "MT6833": "MediaTek Dimensity 700",
    "MT6833P": "MediaTek Dimensity 6020",
    "MT6833V/ZA": "MediaTek Dimensity 700",
    "MT6833V/NZA": "MediaTek Dimensity 700",
    "MT6833V/PNZA": "MediaTek Dimensity 6020",
    "MT6833V/MNZA": "MediaTek Dimensity 700",

    "MT6799": "MediaTek Helio X30",
    "MT6797": "MediaTek Helio X20",
    "MT6797M": "MediaTek Helio X20",
    "MT6795": "MediaTek Helio X10",
    "MT6789": "MediaTek Helio G99",
    "MT6789V/CD": "MediaTek Helio G99",
    "MT6789V/CDZA": "MediaTek Helio G99",
    "MT6785": "MediaTek Helio G95",
    "MT6785T": "MediaTek Helio G90T",
    "MT6785U": "MediaTek Helio G95",
    "MT6785V/CD": "MediaTek Helio G95",
    "MT6785V/WU": "MediaTek Helio G99",
    "MT6785V/WV": "MediaTek Helio G99",
    "MT6781": "MediaTek Helio G96",
    "MT6781V/CD": "MediaTek Helio G96",
    "MT6779": "MediaTek Helio P90",
    "MT6779P90": "MediaTek Helio P90",
    "MT6779P95": "MediaTek Helio P95",
    "MT6779V/CE": "MediaTek Helio P90",
    "MT6771": "MediaTek Helio P60",
    "MT6771T": "MediaTek Helio P70",
    "MT6769": "MediaTek Helio G80",
    "MT6769H": "MediaTek Helio G88",
    "MT6769T": "MediaTek Helio G80",
    "MT6769Z": "MediaTek Helio G85",
    "MT6769V/CA": "MediaTek Helio G85",
    "MT6769V/CB": "MediaTek Helio G80",
    "MT6769V/CT": "MediaTek Helio G80",
    "MT6769V/CZ": "MediaTek Helio G85",
    "MT6769V/WA": "MediaTek Helio G80",
    "MT6769V/WY": "MediaTek Helio G85",
    "MT6768": "MediaTek Helio P65",
    "MT6768V/CB": "MediaTek Helio G85",
    "MT6765": "MediaTek Helio P35",
    "MT6765G": "MediaTek Helio G35",
    "MT6765H": "MediaTek Helio G37",
    "MT6765X": "MediaTek Helio G36",
    "MT6765V/CA": "MediaTek Helio P35",
    "MT6765V/CB": "MediaTek Helio P35",
    "MT6765V/WA": "MediaTek Helio P35",
    "MT6765V/WB": "MediaTek Helio P35",
    "MT6765V/XAA": "MediaTek Helio G35",
    "MT6765V/XBA": "MediaTek Helio G37",
    "MT6763": "MediaTek Helio P23",
    "MT6763T": "MediaTek Helio P23",
    "MT6762": "MediaTek Helio P22",
    "MT6762D": "MediaTek Helio A25",
    "MT6762G": "MediaTek Helio G25",
    "MT6762M": "MediaTek Helio P22",
    "MT6762R": "MediaTek Helio P22",
    "MT6762V/CA": "MediaTek Helio P22",
    "MT6762V/CB": "MediaTek Helio P22",
    "MT6762V/WA": "MediaTek Helio P22",
    "MT6762V/WB": "MediaTek Helio P22",
    "MT6762V/WD": "MediaTek Helio P22",
    "MT6761": "MediaTek Helio A22",
    "MT6761D": "MediaTek Helio A20",
    "MT6761V/CA": "MediaTek Helio A22",
    "MT6761V/CAB": "MediaTek Helio A22",
    "MT6761V/CB": "MediaTek Helio A22",
    "MT6761V/CD": "MediaTek Helio A22",
    "MT6761V/WAB": "MediaTek Helio A22",
    "MT6761V/WB": "MediaTek Helio A22",
    "MT6761V/WBB": "MediaTek Helio A22",
    "MT6761V/WE": "MediaTek Helio A22",
    "MT6758": "MediaTek Helio P30",
    "MT6757": "MediaTek Helio P20",
    "MT6757CD": "MediaTek Helio P25",
    "MT6757V": "MediaTek Helio P25",
    "MT6755": "MediaTek Helio P10",
    "MT6755M": "MediaTek Helio P10",
    "MT6750": "MediaTek MT6750",
    "MT6750T": "MediaTek MT6750T",
    "MT8799": "MediaTek Dimensity 9400+",
    "MT8798Z/CNZA": "MediaTek Dimensity 9000",
    "MT8798Z/CZA": "MediaTek Dimensity 9000",
    "MT8798Z/TNZA": "MediaTek Dimensity 9000+",
    "MT8797": "MediaTek Kompanio 1300T",
    "MT8797Z/CZA": "MediaTek Kompanio 1300T",
    "MT8792": "MediaTek Kompanio 838",
    "MT8791": "MediaTek Kompanio 900T",
    "MT8791V/HNZA": "MediaTek Kompanio 900T",
    "MT8791V/HZA": "MediaTek Kompanio 900T",
    "MT8791V/T": "MediaTek Kompanio 900T",
    "MT8789": "MediaTek Kompanio 1300T",
    "MT8789V/CT": "MediaTek Kompanio 1300T",
    "MT8789V/T": "MediaTek Kompanio 1300T",
    "MT8789V/WT": "MediaTek Kompanio 1300T",
    "MT8788": "MediaTek Helio P60T",
    "MT8788A": "MediaTek Helio P60T",
    "MT8788B": "MediaTek Helio P60T",
    "MT8786": "MediaTek Helio G85",
    "MT8786V/CA": "MediaTek Helio G85",
    "MT8786V/CT": "MediaTek Helio G85",
    "MT8786V/CU": "MediaTek Helio G85",
    "MT8781V/CA": "MediaTek Helio G99",
    "MT8781V/NA": "MediaTek Helio G99",
    "MT8771": "MediaTek Kompanio 820",
    "MT8771V/NZA": "MediaTek Kompanio 820",
    "MT8768": "MediaTek Helio P22T",
    "MT8768A": "MediaTek Helio P22T",
    "MT8768B": "MediaTek Helio P22T",
    "MT8768CA": "MediaTek Helio P22T",
    "MT8768E": "MediaTek Helio P22T",
    "MT8768N": "MediaTek Helio P22T",
    "MT8768T": "MediaTek Helio P22T",
    "MT8768V/CX": "MediaTek Helio P22T",
    "MT8768WA": "MediaTek Helio P22T",
    "MT8768WE": "MediaTek Helio P22T",
    "MT8768WT": "MediaTek Helio P22T",
    "MT8766": "MediaTek Helio A22T",
    "MT8766A": "MediaTek Helio A22T",
    "MT8766B": "MediaTek Helio A22T",
    "MT8183": "MediaTek Helio P60T",
    "MT8183A": "MediaTek Helio P60T",
    "MT8195": "MediaTek Kompanio 1200",
    "MT8195AV": "MediaTek Kompanio 1200",
    "MT8195VV": "MediaTek Kompanio 1200",

    // --- Samsung Exynos (s5e part numbers -> commercial) ---
    "S5E9965": "Exynos 2600",
    "S5E9955": "Exynos 2500",
    "S5E9945": "Exynos 2400",
    "S5E9925": "Exynos 2200",
    "S5E8865": "Exynos 1680",
    "S5E8855": "Exynos 1580",
    "S5E8845": "Exynos 1480",
    "S5E8835": "Exynos 1380",
    "S5E8825": "Exynos 1280",
    "S5E8535": "Exynos 1330",
    "S5E8365": "Exynos 1610",

    // --- Spreadtrum / Unisoc ---
    "UMS9632": "Unisoc T8300",
    "UMS9632S": "Unisoc T8300",
    "UMS9621S": "Unisoc T765",
    "UMS9620": "Unisoc T820",
    "UMS9360": "Unisoc T7300",
    "UMS9230": "Unisoc T606",
    "UMS9230E": "Unisoc T606",
    "UMS9230H": "Unisoc T606",
    "UMS9230S": "Unisoc T606",
    "UMS9230T": "Unisoc T606",
    "UMS312": "Unisoc T310",
    "T310": "Unisoc T310",
    "T603": "Unisoc T603",
    "T606": "Unisoc T606",
    "T610": "Unisoc T610",
    "T612": "Unisoc T612",
    "T615": "Unisoc T615",
    "T616": "Unisoc T616",
    "T618": "Unisoc T618",
    "T619": "Unisoc T619",
    "T620": "Unisoc T620",
    "T750": "Unisoc T750",
    "T7510": "Unisoc T7510",
    "T760": "Unisoc T760",
    "T765": "Unisoc T765",
    "T770": "Unisoc T770",
    "T820": "Unisoc T820",

    // --- HiSilicon Kirin ---
    "HI3630": "Kirin 920",
    "HI3620": "Kirin K3V2",
    "HI6220": "Kirin 620",

    // --- XRing ---
    "XRING O1": "Xiaomi XRING O1",
    "XRING O3": "Xiaomi XRING O3",
};

export function resolveCommercialSoc(processorName, gpu = "") {
    const raw = String(processorName || "").trim();
    if (!raw) return "";

    const upper = raw.toUpperCase();

    // 1. Google Tensor already uses commercial branding
    if (/^Google\s+Tensor/i.test(raw)) {
        return raw.replace(/\s+/g, " ").trim();
    }

    // 2. XRing (Xiaomi)
    if (/^XRing\s+O(\d+)/i.test(raw)) {
        const m = raw.match(/^XRing\s+(O\d+)/i);
        return `Xiaomi XRING ${m[1].toUpperCase()}`;
    }

    // 3. Strip vendor prefixes to lookup core code
    const stripped = raw
        .replace(/^(?:QTI|Qualcomm|Mediatek|MediaTek|Samsung|Spreadtrum|Unisoc|HiSilicon)\s+/i, "")
        .trim();
    const strippedUpper = stripped.toUpperCase();

    if (SOC_CODE_MAP[strippedUpper]) {
        return SOC_CODE_MAP[strippedUpper];
    }

    // Also try without trailing single-letter / slash variants if not exact match
    if (SOC_CODE_MAP[upper]) {
        return SOC_CODE_MAP[upper];
    }

    // 4. Samsung Exynos already labeled "Samsung Exynos XXXX"
    if (/^Samsung\s+Exynos\s+/i.test(raw)) {
        return raw.replace(/^Samsung\s+/i, "").replace(/\s+/g, " ").trim();
    }

    // 5. HiSilicon Kirin codes ("HiSilicon KIRIN980" -> "Kirin 980")
    const kirinMatch = stripped.match(/^KIRIN\s*([0-9]+[A-Za-z]*)$/i);
    if (kirinMatch) {
        return `Kirin ${kirinMatch[1].toLowerCase() === "960s" ? "960s" : kirinMatch[1].toUpperCase()}`;
    }

    // 6. Spreadtrum -> Unisoc branding cleanly
    if (/^Spreadtrum\s+/i.test(raw)) {
        return raw.replace(/^Spreadtrum\s+/i, "Unisoc ").replace(/\s+/g, " ").trim();
    }

    // 7. MediaTek fallback (clean casing "MediaTek MT6580", etc.)
    if (/^Mediatek\s+/i.test(raw)) {
        const code = raw.replace(/^Mediatek\s+/i, "").trim();
        const baseCode = code.split(/[Vv/_-]/)[0].toUpperCase();
        if (SOC_CODE_MAP[baseCode]) {
            return SOC_CODE_MAP[baseCode];
        }
        return `MediaTek ${code}`;
    }

    // 8. Qualcomm / QTI fallback
    if (/^(?:Qualcomm|QTI)\s+/i.test(raw)) {
        const code = raw.replace(/^(?:Qualcomm|QTI)\s+/i, "").trim();
        const cleanBase = code.toUpperCase();
        if (SOC_CODE_MAP[cleanBase]) return SOC_CODE_MAP[cleanBase];
        // Clean prefix
        return `Snapdragon (${code})`;
    }

    // 9. NVIDIA Tegra / Rockchip / Allwinner / Amlogic / Intel / TI / Marvell
    if (/^NVidia\s+/i.test(raw)) {
        return raw.replace(/^NVidia\s+/i, "NVIDIA ").replace(/\s+/g, " ").trim();
    }

    if (gpu && /Adreno\s+740/i.test(gpu) && /SM8550/i.test(raw)) {
        return "Snapdragon 8 Gen 2";
    }

    return raw.replace(/\s+/g, " ").trim();
}

export function cleanModelName(manufacturer, rawModel) {
    let model = String(rawModel || "").trim();
    if (!model) return "";

    // Fix CSV escaped double quotes like "Alba 10""" -> Alba 10"
    model = model.replace(/^"+|"+$/g, "").replace(/""+/g, '"').trim();

    // Remove redundant repeated manufacturer prefix if exact start (preserving iconic sub-brands like Galaxy, POCO, Redmi, Pixel, Moto)
    const mfg = String(manufacturer || "").trim();
    if (mfg) {
        const escapedMfg = mfg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Keep brand if model is very short without it, otherwise strip duplicate prefix like "INOI INOI A62" -> "INOI A62" or keep consistent display
        model = model.replace(new RegExp(`^${escapedMfg}\\s+${escapedMfg}\\b`, "i"), mfg);
    }

    // Strip RAM / storage variants from model names:
    // Matches e.g.: "(2GB)", "(8GB/256GB)", "4+64GB", "8/128GB", "1-64GB", "6GB", "128 GB", "128G", "256GB", "1TB", "4GB RAM"
    const cap = "(?:1|2|3|4|6|8|12)\\s*(?:GB|MB)|(?:16|24|32|64|128|256|512)\\s*G(?:B)?|(?:1|2)\\s*TB";
    model = model
        // Parenthesized RAM/storage: (2GB), (4GB/64GB), (8+128GB)
        .replace(new RegExp(`\\(\\s*(?:\\d{1,3}\\s*[+/\\-]\\s*)?(?:${cap})(?:\\s*RAM|\\s*ROM)?\\s*\\)`, "gi"), " ")
        // Combined RAM+Storage or RAM/Storage: 4+64GB, 8/128GB, 1-64GB, 4+64G
        .replace(new RegExp(`(?:^|[\\s/\\-])\\d{1,2}\\s*[+/\\-]\\s*(?:${cap})(?=$|[\\s/\\-,])`, "gi"), " ")
        // Standalone RAM/storage capacities: " 6GB", " 128 GB", " 64G", "-2GB", " 256GB"
        .replace(new RegExp(`(?:^|[\\s\\-_])(?:${cap})(?:\\s*(?:RAM|ROM))?(?=$|[\\s\\-_,])`, "gi"), " ");

    // Strip regional / carrier suffixes that cause duplicate hardware entries
    model = model
        .replace(/(?:_|\s+)(?:EEA|ROW|GLOBAL|LATAM|IND|IN|TR|RU|EU|JP|CN|TW|KR|US|CA|CH|UK)(?=$|\s)/gi, "")
        .replace(/\s+(?:中国版|国际版)$/g, "")
        .replace(/[_]+/g, " ")
        .replace(/\s*[-/]\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    // Build clean display model without duplicating manufacturer if already present
    return model;
}

export function formatDeviceDisplayModel(manufacturer, cleanedModel) {
    const mfg = String(manufacturer || "").trim();
    const model = String(cleanedModel || "").trim();
    if (!model) return mfg;
    if (!mfg) return model;

    // Avoid "Samsung Galaxy S23" vs "Galaxy S23" inconsistency:
    // If model already starts with manufacturer (case-insensitive) or well-known sub-brand
    if (model.toLowerCase().startsWith(mfg.toLowerCase())) {
        return model;
    }
    // Iconic line names where manufacturer is optional or helpful:
    // Always prepend manufacturer for clarity unless model already starts with it, EXCEPT Redmi/POCO under Xiaomi if Xiaomi is mfg? Actually "Xiaomi Redmi Note 13" or "Samsung Galaxy S23" is super searchable and unambiguous!
    return `${mfg} ${model}`;
}

export function normalizeDevicePart(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export function deviceSlug(value) {
    return normalizeDevicePart(value).replace(/\s+/g, "-").slice(0, 140);
}

export function hashDeviceKey(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
