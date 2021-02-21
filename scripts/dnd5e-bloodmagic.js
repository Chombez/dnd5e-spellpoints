// @flow
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};

const MODULE_NAME = 'bloodmagic-5e';

Handlebars.registerHelper("spFormat", (path, ...args) => {
  return game.i18n.format(path, args[0].hash);
});

class BloodMagic {
  static get settings() {
    return mergeObject(this.defaultSettings, game.settings.get(MODULE_NAME, 'settings'));
  }
  /**
   * Get default settings object.
   * @returns ChatPortraitSetting
   */
  static get defaultSettings() {
    return {
      spEnableBloodMagic: false,
      spellPointsCosts: {1:2,2:3,3:5,4:6,5:7,6:9,7:10,8:11,9:13},
      spLifeCost: 1,
    };
  }

  static isModuleActive(){
    return game.settings.get(MODULE_NAME, 'spEnableBloodMagic');
  }

  static isActorCharacter(actor){
    return getProperty(actor, "data.type") == "character";
  }

  static isMixedActorSpellPointEnabled(actor){
    console.log(actor);
    if (actor.flags !== undefined) {
      if (actor.flags.dnd5ebloodmagic !== undefined) {
        if (actor.flags.dnd5ebloodmagic.enabled !== undefined ){
          return actor.flags.dnd5ebloodmagic.enabled
        }
      }
    }
    return false;
  }

  static castSpell(actor, update) {
    console.log('Cast Spell',actor, update);
    /** do nothing if module is not active **/
    if (!BloodMagic.isModuleActive() || !BloodMagic.isActorCharacter(actor))
      return update;

    console.log(MODULE_NAME, 'active, is actor');

    /* Check if BloodMagic is enabled for this actor */
    if (!BloodMagic.isMixedActorSpellPointEnabled(actor.data))
      return update;

    let spell = getProperty(update, "data.spells");
    if (!spell || spell === undefined)
      return update;

     /** find the spell level just cast */
    const spellLvlNames = ["spell1", "spell2", "spell3", "spell4", "spell5", "spell6", "spell7", "spell8", "spell9", "pact"];
    let spellLvlIndex = spellLvlNames.findIndex(name => { return getProperty(update, "data.spells." + name) });

    let spellLvl = spellLvlIndex + 1;

    //** slot calculation **/
    const origSlots = actor.data.data.spells;
    const preCastSlotCount = getProperty(origSlots, spellLvlNames[spellLvlIndex] + ".value");
    const postCastSlotCount = getProperty(update, "data.spells." + spellLvlNames[spellLvlIndex] + ".value");
    let maxSlots = getProperty(origSlots, spellLvlNames[spellLvlIndex] + ".max");

    let slotCost = preCastSlotCount - postCastSlotCount;

    /** restore slots to the max if spell level less than 6 **/
    if (typeof maxSlots === undefined) {
      maxSlots = 1;
      update.data.spells[spellLvlNames[spellLvlIndex]].max = maxSlots;
    }
    if (spellLvl < 6) {
      // Regular low level spell cast, reset spell slots to max
      update.data.spells[spellLvlNames[spellLvlIndex]].value = maxSlots;
    } else {
      // Spell lvl 6+
      if (postCastSlotCount == maxSlots) {
        // This triggered on a long rest, a spell is not being cast
        return update;
      }
      // Can only cast one spell per level above 6 per long rest)
      ChatMessage.create({
        content: "<i style='color:red;'>"+game.i18n.format("bloodmagic.castPowerSpell", { ActorName : actor.data.name, SpellLvl : spellLvl })+"</i>",
        speaker: ChatMessage.getSpeaker({ alias: actor.data.name })
      });
      // Block this level spell being cast again till long rest
      update.data.spells[spellLvlNames[spellLvlIndex]].value = 0;
    }

   /* get spell cost in spellpoints */
    const spellPointCost = this.settings.spellPointsCosts[spellLvl];

    const hpLost = spellPointCost * BloodMagic.settings.spLifeCost;
    const currentHp = actor.data.data.attributes.hp.value;
    const hpNew = currentHp - hpLost;

    if (hpNew <= 0) { //character is unconsious
      // 1 death saves failed and 0 hp
      update.data.attributes = {'death':{'failure':1}, 'hp':{'value':0}};
      ChatMessage.create({
        content: "<i style='color:red;'>"+game.i18n.format("bloodmagic.castedLifeDead", { ActorName : actor.data.name })+"</i>",
        speaker: ChatMessage.getSpeaker({ alias: actor.data.name })
      });
    } else {
      update.data.attributes = {'hp':{'value':hpNew}};// hp reduction
    }
    return update;
  }

  static checkDialogBloodMagic(dialog, html, formData){
    if (!BloodMagic.isModuleActive())
      return;

    let actor = getProperty(dialog, "item.options.actor");

    /** check if actor is a player character **/
    if(!this.isActorCharacter(actor))
      return;

    console.log(MODULE_NAME,'checkDialogBloodMagic', actor, dialog, html, formData);

    /* if mixedMode active Check if BloodMagic is enabled for this actor */
    if (!BloodMagic.isMixedActorSpellPointEnabled(actor.data))
      return;

    /** check if this is a spell **/
    let isSpell = false;
    if ( dialog.item.data.type === "spell" ) {
      if ( dialog.item.data.data.preparation.mode === "atwill" || dialog.item.data.data.preparation.mode === "innate" )
        // Ignore for at-will or innate spells
        return

      isSpell = true;
    }

    if (!isSpell)
      return;

    console.log(MODULE_NAME,'is spell');

    const spell = dialog.item.data;
    // spell level can change later if casting it with a greater slot, baseSpellLvl is the default
    const baseSpellLvl = spell.data.level;

    let currentHp = getProperty(actor, "data.data.attributes.hp.value");
    let spellPointCost = this.settings.spellPointsCosts[baseSpellLvl];

    if (currentHp - spellPointCost < 0) {
      $('#ability-use-form', html).append('<div class="spError">'+game.i18n.localize("bloodmagic.youNotEnough")+'</div>');
    }

    let copyButton = $('.dialog-button', html).clone();
    $('.dialog-button', html).addClass('original').hide();
    copyButton.addClass('copy');
    $('.dialog-buttons', html).append(copyButton);

    html.on('click','.dialog-button.copy', function(e){
      /** if consumeSlot we ignore cost, go on and cast **/
      if ($('select[name="level"]', html).length > 0) {
        let spellLvl = $('select[name="level"]', html).val();
        console.log(MODULE_NAME,'spellLvl',spellLvl);
        spellPointCost = BloodMagic.settings.spellPointsCosts[spellLvl];
        console.log(MODULE_NAME,'spellPointCost',spellPointCost);
        if (currentHp - spellPointCost < 0) {
          ui.notifications.error("You don't have enough: Hit Points to cast this spell");
          dialog.close();
        } else {
          $('.dialog-button.original', html).trigger( "click" );
        }
      }
    })
  }

  /**
  * mixed Mode add a button to spell sheet
  *
  **/

  static mixedMode(app, html, data){
    console.log(data)
    if (!this.isModuleActive() || data.actor.type != "character") {
      return;
    }

    let checked = "";
    if (BloodMagic.isMixedActorSpellPointEnabled(data.actor)) {
      checked = "checked";
    }
    let html_checkbox = '<div class="spEnable flexrow "><label><i class="fas fa-magic"></i>&nbsp;';
    html_checkbox += game.i18n.localize('bloodmagic.use-bloodmagic');

    html_checkbox += '<input name="flags.dnd5ebloodmagic.enabled" '+checked+' class="spEnableInput visually-hidden" type="checkbox" value="1">';
    html_checkbox += ' <i class="spEnableCheck fas"></i>';
    html_checkbox += '</label></div>';
    $('.tab.spellbook', html).prepend(html_checkbox);
  }

} /** END SpellPoint Class **/


/**
* SPELL POINTS APPLICATION SETTINGS FORM
*/
class BloodMagicForm extends FormApplication {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      title: game.i18n.localize('bloodmagic.form-title'),
      id: 'bloodmagic-form',
      template: `modules/${MODULE_NAME}/templates/bloodmagic-config.html`,
      width: 500,
      closeOnSubmit: true
    });
  }

  getData(options) {
    return this.reset ? BloodMagic.defaultSettings :
      mergeObject(BloodMagic.defaultSettings, game.settings.get(MODULE_NAME, 'settings'));
  }

  onReset() {
    this.reset = true;
    this.render();
  }

  _updateObject(event, formData) {
    return __awaiter(this, void 0, void 0, function* () {
      let settings = mergeObject(BloodMagic.settings, formData, { insertKeys: true, insertValues: true });
      yield game.settings.set(MODULE_NAME, 'settings', settings);
    });
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find('button[name="reset"]').click(this.onReset.bind(this));
  }
} /** end SpellPointForm **/

Hooks.on('init', () => {
  console.log('BloodMagic BloodMagic init');
  /** should spellpoints be enabled */
  game.settings.register(MODULE_NAME, "spEnableBloodMagic", {
    name: "Enable Blood Magic system",
    hint: "Enables or disables blood magic for casting spells, this will override the slot cost for player tokens.",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    onChange: spEnableBloodMagic => {
      window.location.reload();
    }
  });

  game.settings.registerMenu(MODULE_NAME, MODULE_NAME, {
    name: "bloodmagic.form",
    label: "bloodmagic.form-title",
    hint: "bloodmagic.form-hint",
    icon: "fas fa-magic",
    type: BloodMagicForm,
    restricted: true
  });

  game.settings.register(MODULE_NAME, "settings", {
    name: "Blood Magic Settings",
    scope: "world",
    default: BloodMagicForm.defaultSettings,
    type: Object,
    config: false,
    onChange: (x) => window.location.reload()
  });
});

// collate all preUpdateActor hooked functions into a single hook call
Hooks.on("preUpdateActor", async (actor, update, options, userId) => {
  console.log(MODULE_NAME, 'preUpdateActor', actor, update, options);
  update = BloodMagic.castSpell(actor, update);
});

/** spell launch dialog **/
// renderAbilityUseDialog renderApplication
Hooks.on("renderAbilityUseDialog", async (dialog, html, formData) => {
  console.log(MODULE_NAME, 'renderAbilityUseDialog');
  BloodMagic.checkDialogBloodMagic(dialog, html, formData);
})

Hooks.on("renderActorSheet5e", (app, html, data) => {
  console.log(MODULE_NAME, 'renderActorSheet5e');
  BloodMagic.mixedMode(app, html, data);
});
