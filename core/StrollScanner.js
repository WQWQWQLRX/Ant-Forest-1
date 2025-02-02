/*
 * @Author: TonyJiangWJ
 * @Date: 2020-09-07 13:06:32
 * @Last Modified by: TonyJiangWJ
 * @Last Modified time: 2023-01-09 10:14:01
 * @Description: 逛一逛收集器
 */
let { config: _config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let _widgetUtils = singletonRequire('WidgetUtils')
let automator = singletonRequire('Automator')
let _commonFunctions = singletonRequire('CommonFunction')
let fileUtils = singletonRequire('FileUtils')
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let localOcrUtil = require('../lib/LocalOcrUtil.js')

let BaseScanner = require('./BaseScanner.js')

const DuplicateChecker = function () {

  this.duplicateChecked = {}

  /**
   * 校验是否全都重复校验过了
   */
  this.checkIsAllDuplicated = function () {
    if (Object.keys(this.duplicateChecked).length === 0) {
      return false
    }
    for (let key in this.duplicateChecked) {
      if (this.duplicateChecked[key].count <= 1) {
        return false
      }
    }
    return true
  }

  /**
   * 记录 白名单、保护罩好友 重复访问次数的数据
   * @param {*} obj 
   */
  this.pushIntoDuplicated = function (obj) {
    let exist = this.duplicateChecked[obj.name]
    if (exist) {
      exist.count++
    } else {
      exist = { name: obj.name, count: 1 }
      this.duplicateChecked[obj.name] = exist
    }
  }

}

const StrollScanner = function () {
  BaseScanner.call(this)
  this.duplicateChecker = new DuplicateChecker()
  this.init = function (option) {
    this.current_time = option.currentTime || 0
    this.increased_energy = option.increasedEnergy || 0
    this.createNewThreadPool()
  }

  this.start = function () {
    debugInfo('逛一逛即将开始')
    return this.collecting()
  }

  this.destroy = function () {
    debugInfo('逛一逛结束')
    this.baseDestroy()
  }

  /**
   * 执行收集操作
   * 
   * @return { true } if failed
   * @return { minCountdown, lostSomeone } if successful
   */
  this.collecting = function () {
    let hasNext = true
    let region = null
    if (_config.stroll_button_left && !_config.stroll_button_regenerate && !this._regenerate_stroll_button) {
      region = [_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height]
    } else {
      let successful = regenerateStrollButton()
      if (!successful) {
        warnInfo('自动识别逛一逛按钮失败，请主动配置区域或者图片信息', true)
        hasNext = false
      } else {
        region = [_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height]
      }
    }
    while (hasNext) {
      if (this.duplicateChecker.checkIsAllDuplicated()) {
        debugInfo('全部都在白名单，没有可以逛一逛的了')
        break
      }
      debugInfo(['逛下一个, click random region: [{}]', JSON.stringify(region)])
      this.visualHelper.addRectangle('准备点击下一个', region)
      this.visualHelper.displayAndClearAll()
      automator.clickRandomRegion({ left: region[0], top: region[1], width: region[2], height: region[3] })
      sleep(300)
      hasNext = this.collectTargetFriend()
    }
    let result = { regenerate_stroll_button: this._regenerate_stroll_button }
    Object.assign(result, this.getCollectResult())
    return result
  }

  this.backToListIfNeeded = function (rentery, obj, temp) {
    if (!rentery) {
      debugInfo('准备逛下一个，等待200ms')
      sleep(200)
      return true
    } else {
      debugInfo('二次校验好友信息，等待250ms')
      sleep(250)
      obj.recheck = true
      return this.doCollectTargetFriend(obj, temp)
    }
  }

  this.doIfProtected = function (obj) {
    this.duplicateChecker.pushIntoDuplicated(obj)
  }

  /**
   * 逛一逛模式进行特殊处理
   */
  this.getFriendName = function () {
    let friendNameGettingRegex = _config.friend_name_getting_regex || '(.*)的蚂蚁森林'
    let titleContainer = _widgetUtils.alternativeWidget(friendNameGettingRegex, _config.stroll_end_ui_content || /^返回(我的|蚂蚁)森林>?|去蚂蚁森林.*$/, null, true, null, { algorithm: 'PVDFS' })
    if (titleContainer.value === 1) {
      let regex = new RegExp(friendNameGettingRegex)
      if (titleContainer && regex.test(titleContainer.content)) {
        return regex.exec(titleContainer.content)[1]
      } else {
        errorInfo(['获取好友名称失败，请检查好友首页文本"{}"是否存在', friendNameGettingRegex])
      }
    }
    debugInfo(['未找到{} {}', friendNameGettingRegex, titleContainer.value === 2 ? '找到了逛一逛结束标志' : ''])
    return false
  }
}

StrollScanner.prototype = Object.create(BaseScanner.prototype)
StrollScanner.prototype.constructor = StrollScanner

StrollScanner.prototype.collectTargetFriend = function () {
  let obj = {}
  debugInfo('等待进入好友主页')
  let restartLoop = false
  let count = 1
  ///sleep(1000)
  let alternativeFriendOrDone = 0
  if (auto.clearCache) {
    let start = new Date().getTime()
    auto.clearCache()
    debugInfo(['刷新根控件成功: {}ms', (new Date().getTime() - start)])
  }
  // 未找到好友首页控件 循环等待三次
  while ((alternativeFriendOrDone = _widgetUtils.alternativeWidget(_config.friend_home_check_regex, _config.stroll_end_ui_content || /^返回(我的|蚂蚁)森林>?|去蚂蚁森林.*$/, null, false, null, { algorithm: 'PVDFS' })) !== 1) {
    // 找到了结束标志信息 停止逛一逛
    let ended = false
    if (alternativeFriendOrDone === 2) {
      debugInfo('逛一逛啥也没有，不再瞎逛')
      ended = true
    }
    if (this.checkAndCollectRain()) {
      ended = true
    }
    if (ended) {
      return false
    }
    debugInfo(
      '未能进入主页，等待500ms count:' + count++
    )
    sleep(500)
    if (count >= 3) {
      if (regenerateStrollButton()) {
        let region = [_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height]
        automator.clickRandomRegion({ left: region[0], top: region[1], width: region[2], height: region[3] })
        sleep(1000)
        continue
      }
      this._regenerate_stroll_button = true
      warnInfo('重试超过3次，取消操作')
      restartLoop = true
      break
    }
  }
  if (restartLoop) {
    errorInfo('页面流程出错，跳过好友能量收集')
    return false
  }
  let name = this.getFriendName()
  if (name) {
    obj.name = name
    debugInfo(['进入好友[{}]首页成功', obj.name])
  } else {
    this.checkAndCollectRain()
    return false
  }
  let skip = false
  if (!skip && _config.white_list && _config.white_list.indexOf(obj.name) >= 0) {
    debugInfo(['{} 在白名单中不收取他', obj.name])
    skip = true
  }
  if (!skip && _commonFunctions.checkIsProtected(obj.name)) {
    warnInfo(['{} 使用了保护罩 不收取他', obj.name])
    skip = true
  }
  if (skip) {
    this.duplicateChecker.pushIntoDuplicated(obj)
    return true
  }
  if (!obj.recheck) {
    // 增加延迟 避免展开好友动态失败
    sleep(100)
    this.protectInfoDetect(obj.name)
  } else {
    this.isProtected = false
    this.isProtectDetectDone = true
  }
  this.saveButtonRegionIfNeeded()
  let result = this.doCollectTargetFriend(obj)
  if (!this.collect_any) {
    // 未收取任何能量，可能发生了异常或者识别出错 将其放入重复队列
    this.duplicateChecker.pushIntoDuplicated(obj)
  }
  return result
}

StrollScanner.prototype.checkAndCollectRain = function () {
  let target = null
  auto.clearCache && auto.clearCache()
  if ((target = _widgetUtils.widgetGetOne(_config.rain_entry_content || '.*能量雨.*', 500, true)) != null) {
    if (!_config.collect_rain_when_stroll) {
      debugInfo('找到能量雨开始标志，但是不需要执行能量雨')
      return true
    }
    if (/已完成/.test(target.content)) {
      debugInfo('今日能量雨已完成')
      return true
    }
    sleep(1000)
    debugInfo('找到能量雨开始标志，准备自动执行能量雨脚本')
    target = _widgetUtils.widgetGetOne('去收取')
    if (target) {
      automator.clickCenter(target)
      sleep(1000)
      let source = fileUtils.getCurrentWorkPath() + '/unit/能量雨收集.js'
      runningQueueDispatcher.doAddRunningTask({source: source})
      engines.execScriptFile(source, { path: source.substring(0, source.lastIndexOf('/')), arguments: { executeByStroll: true, executorSource: engines.myEngine().getSource() + '' } })
      _commonFunctions.commonDelay(2.5, '执行能量雨[', true, true)
      automator.back()
    } else {
      debugInfo('未找到去收取，执行能量雨脚本失败')
    }
    this.showCollectSummaryFloaty()
    return true
  }
  return false
}

StrollScanner.prototype.saveButtonRegionIfNeeded = function () {
  if (_config.stroll_button_regenerate) {
    _config.overwrite('stroll_button_left', _config.stroll_button_left)
    _config.overwrite('stroll_button_top', _config.stroll_button_top)
    _config.overwrite('stroll_button_width', _config.stroll_button_width)
    _config.overwrite('stroll_button_height', _config.stroll_button_height)
    _config.overwrite('stroll_button_regenerate', false)
    debugInfo(['保存重新生成的逛一逛按钮区域：{}', JSON.stringify([_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height])])
  }
}
module.exports = StrollScanner


// inner functions

function refillStrollInfo(region) {
  _config.stroll_button_left = parseInt(region[0])
  _config.stroll_button_top = parseInt(region[1])
  _config.stroll_button_width = parseInt(region[2])
  _config.stroll_button_height = parseInt(region[3])
  // 用于执行保存数值
  _config.stroll_button_regenerate = true

  debugInfo(['重新生成逛一逛按钮区域：{}', JSON.stringify(region)])
}

function ocrFindText(screen, text, tryTime) {
  tryTime = tryTime || 0
  let ocrCheck = localOcrUtil.recognizeWithBounds(screen, null, text)
  if (ocrCheck && ocrCheck.length > 0) {
    return ocrCheck[0]
  } else {
    if (--tryTime > 0) {
      sleep(500)
      return ocrFindText(screen, text, tryTime)
    }
    return null
  }
}

function regenerateByOcr(screen) {
  let ocrCheck = ocrFindText(screen, '找能量', 3)
  if (ocrCheck) {
    let bounds = ocrCheck.bounds
    if (!bounds) {
      return false
    }
    region = [
      bounds.left, bounds.top,
      bounds.width(), bounds.height()
    ]
    refillStrollInfo(region)
    return true
  }
  return false
}

function regenerateByImg(screen) {
  let imagePoint = OpenCvUtil.findByGrayBase64(screen, _config.image_config.stroll_icon)
  if (!imagePoint) {
    imagePoint = OpenCvUtil.findBySIFTGrayBase64(screen, _config.image_config.stroll_icon)
  }
  if (imagePoint) {
    region = [
      imagePoint.left, imagePoint.top,
      imagePoint.width(), imagePoint.height()
    ]
    refillStrollInfo(region)
    _commonFunctions.ensureRegionInScreen(region)
    return true
  }
  return false
}

function regenerateStrollButton() {
  if (!_config.image_config.stroll_icon && !localOcrUtil.enabled) {
    warnInfo(['请配置逛一逛按钮图片或者手动指定逛一逛按钮区域'], true)
    return false
  }
  let screen = _commonFunctions.checkCaptureScreenPermission()
  if (!screen) {
    errorInfo(['获取截图失败'])
    return false
  }
  let successful = true
  if (!regenerateByOcr(screen)) {
    successful = regenerateByImg(screen)
  }
  return successful
}
