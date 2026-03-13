const fs = require('fs');

function parseTimeToSeconds(timeStr) {
    timeStr = timeStr.trim();
    const lastSpace = timeStr.lastIndexOf(' ');
    const period = timeStr.substring(lastSpace + 1).toLowerCase();
    const timeParts = timeStr.substring(0, lastSpace).split(':');
    let hours = parseInt(timeParts[0]);
    const minutes = parseInt(timeParts[1]);
    const seconds = parseInt(timeParts[2]);
    if (period === 'am') {
        if (hours === 12) hours = 0;
    } else {
        if (hours !== 12) hours += 12;
    }
    return hours * 3600 + minutes * 60 + seconds;
}

function parseDurationToSeconds(durationStr) {
    const parts = durationStr.trim().split(':');
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
}

function secondsToHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function readLines(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').filter(line => line.trim() !== '');
}

function parseShiftLine(line) {
    const parts = line.split(',');
    return {
        driverID: parts[0].trim(),
        driverName: parts[1].trim(),
        date: parts[2].trim(),
        startTime: parts[3].trim(),
        endTime: parts[4].trim(),
        shiftDuration: parts[5].trim(),
        idleTime: parts[6].trim(),
        activeTime: parts[7].trim(),
        metQuota: parts[8].trim() === 'true',
        hasBonus: parts[9].trim() === 'true'
    };
}

function shiftToLine(obj) {
    return `${obj.driverID},${obj.driverName},${obj.date},${obj.startTime},${obj.endTime},${obj.shiftDuration},${obj.idleTime},${obj.activeTime},${obj.metQuota},${obj.hasBonus}`;
}

function parseRateFile(rateFile) {
    const lines = readLines(rateFile);
    const rates = {};
    for (const line of lines) {
        const parts = line.split(',');
        rates[parts[0].trim()] = {
            dayOff: parts[1].trim(),
            basePay: parseInt(parts[2].trim()),
            tier: parseInt(parts[3].trim())
        };
    }
    return rates;
}

function getDayName(dateStr) {
    const parts = dateStr.split('-');
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
}

function isEidPeriod(dateStr) {
    const parts = dateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    return year === 2025 && month === 4 && day >= 10 && day <= 30;
}

function getShiftDuration(startTime, endTime) {
    const startSec = parseTimeToSeconds(startTime);
    const endSec = parseTimeToSeconds(endTime);
    return secondsToHMS(endSec - startSec);
}

function getIdleTime(startTime, endTime) {
    const startSec = parseTimeToSeconds(startTime);
    const endSec = parseTimeToSeconds(endTime);
    const deliveryStart = 8 * 3600;
    const deliveryEnd = 22 * 3600;
    const idleBefore = Math.max(0, Math.min(deliveryStart, endSec) - startSec);
    const idleAfter = Math.max(0, endSec - Math.max(deliveryEnd, startSec));
    return secondsToHMS(idleBefore + idleAfter);
}

function getActiveTime(shiftDuration, idleTime) {
    const shiftSec = parseDurationToSeconds(shiftDuration);
    const idleSec = parseDurationToSeconds(idleTime);
    return secondsToHMS(shiftSec - idleSec);
}

function metQuota(date, activeTime) {
    const activeSec = parseDurationToSeconds(activeTime);
    const quotaSec = isEidPeriod(date) ? 6 * 3600 : 8 * 3600 + 24 * 60;
    return activeSec >= quotaSec;
}

function addShiftRecord(textFile, shiftObj) {
    const lines = readLines(textFile);

    for (const line of lines) {
        const parts = line.split(',');
        if (parts[0].trim() === shiftObj.driverID && parts[2].trim() === shiftObj.date) {
            return {};
        }
    }

    const shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    const idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quota = metQuota(shiftObj.date, activeTime);

    const newRecord = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: shiftDuration,
        idleTime: idleTime,
        activeTime: activeTime,
        metQuota: quota,
        hasBonus: false
    };

    const newLine = shiftToLine(newRecord);

    let lastIndexOfDriver = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].split(',')[0].trim() === shiftObj.driverID) {
            lastIndexOfDriver = i;
        }
    }

    if (lastIndexOfDriver === -1) {
        lines.push(newLine);
    } else {
        lines.splice(lastIndexOfDriver + 1, 0, newLine);
    }

    fs.writeFileSync(textFile, lines.join('\n') + '\n', 'utf8');

    return newRecord;
}

function setBonus(textFile, driverID, date, newValue) {
    const lines = readLines(textFile);

    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts[0].trim() === driverID && parts[2].trim() === date) {
            parts[9] = newValue.toString();
            lines[i] = parts.join(',');
            break;
        }
    }

    fs.writeFileSync(textFile, lines.join('\n') + '\n', 'utf8');
}

function countBonusPerMonth(textFile, driverID, month) {
    const lines = readLines(textFile);
    const monthNum = parseInt(month);
    let found = false;
    let count = 0;

    for (const line of lines) {
        const parts = line.split(',');
        if (parts[0].trim() === driverID) {
            found = true;
            const recordMonth = parseInt(parts[2].trim().split('-')[1]);
            if (recordMonth === monthNum && parts[9].trim() === 'true') {
                count++;
            }
        }
    }

    return found ? count : -1;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const lines = readLines(textFile);
    let totalSeconds = 0;

    for (const line of lines) {
        const parts = line.split(',');
        if (parts[0].trim() === driverID) {
            const recordMonth = parseInt(parts[2].trim().split('-')[1]);
            if (recordMonth === month) {
                totalSeconds += parseDurationToSeconds(parts[7].trim());
            }
        }
    }

    return secondsToHMS(totalSeconds);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const lines = readLines(textFile);
    const rates = parseRateFile(rateFile);
    const driverRate = rates[driverID];
    const dayOff = driverRate.dayOff;

    let totalRequiredSeconds = 0;

    for (const line of lines) {
        const parts = line.split(',');
        if (parts[0].trim() === driverID) {
            const dateStr = parts[2].trim();
            const recordMonth = parseInt(dateStr.split('-')[1]);
            if (recordMonth === month) {
                const dayName = getDayName(dateStr);
                if (dayName !== dayOff) {
                    const quotaSec = isEidPeriod(dateStr) ? 6 * 3600 : 8 * 3600 + 24 * 60;
                    totalRequiredSeconds += quotaSec;
                }
            }
        }
    }

    totalRequiredSeconds -= bonusCount * 2 * 3600;
    if (totalRequiredSeconds < 0) totalRequiredSeconds = 0;

    return secondsToHMS(totalRequiredSeconds);
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rates = parseRateFile(rateFile);
    const driverRate = rates[driverID];
    const basePay = driverRate.basePay;
    const tier = driverRate.tier;

    const actualSec = parseDurationToSeconds(actualHours);
    const requiredSec = parseDurationToSeconds(requiredHours);

    if (actualSec >= requiredSec) {
        return basePay;
    }

    const tierAllowances = { 1: 50, 2: 20, 3: 10, 4: 3 };
    const allowedSec = tierAllowances[tier] * 3600;
    const missingSec = requiredSec - actualSec;
    const effectiveMissingSec = Math.max(0, missingSec - allowedSec);
    const effectiveMissingHours = Math.floor(effectiveMissingSec / 3600);

    const deductionRatePerHour = Math.floor(basePay / 185);
    const salaryDeduction = effectiveMissingHours * deductionRatePerHour;

    return basePay - salaryDeduction;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
