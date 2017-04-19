'use strict'

const {baseKonnector, filterExisting, saveDataAndFile, models} = require('cozy-konnector-libs')
const request = require('request-promise-native')
const cheerio = require('cheerio')

const Bill = models.bill

const logger = require('printit')({
  prefix: 'Harmonie',
  date: true
})

module.exports = baseKonnector.createNew({
  name: 'Harmonie',
  vendorLink: 'www.harmonie-mutuelle.fr',

  category: 'health',
  color: {
    hex: '#D1432B',
    css: 'linear-gradient(to bottom, rgba(255,214,31,1) 0%, rgba(209,68,43,1) 100%)'
  },

  dataType: ['bill'],

  models: [Bill],

  fetchOperations: [
    login,
    paiements,
    reimbursements
    customFilterExisting,
    customSaveDataAndFile
  ]
})

const fileOptions = {
  vendor: 'Harmonie',
  dateFormat: 'YYYYMMDD'
}

const baseUrl = 'https://www.harmonie-mutuelle.fr/'
const userAgent = 'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:37.0) ' +
                  'Gecko/20100101 Firefox/37.0'
const defaultOptions = {
  method: 'GET',
  url: `${baseUrl}`,
  headers: {
    'User-Agent': userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  },
  jar: true,
  simple: false,
}

function login (requiredFields, entries, data, next) {
  let options = defaultOptions
  
  request(defaultOptions)
  .then(body => {
    let $ = cheerio.load(body);
    let actionUrl = $("#_58_fm").prop('action');
    
    $("#_58_login").val(requiredFields.login);
    $("#_58_password").val(requiredFields.password);
    
    let formDataArray = $("#_58_fm").serializeArray();
    let formData = {};
    
    formDataArray.forEach(pair => {
      formData[pair.name] = pair.value;
    });
    
    let options = Object.assign(defaultOptions, {
      method: 'POST',
      url: actionUrl,
      formData: formData,
    })
    
    return request(options)
  })
  .then((response, body) => {
    next();
  })
  .catch(err => {
    logger.error(err)
    return next(err)
  })
}

function paiements(requiredFields, entries, data, next){
  let url = 'https://www.harmonie-mutuelle.fr/web/mon-compte/mes-remboursements';
  
  let options = Object.assign(defaultOptions, {
    url: url
  })
  
  request(options)
  .then(body => {
    let $ = cheerio.load(body)
    let paimentList = {}
    
    $('img.loupe').each((index, elem) => {
      let onclick = elem.attribs.onclick
      if (!onclick) return;
      let chunks = onclick.split("'")
      paimentList[chunks[1]] = chunks[3]
    })
    
    data.paiments = paimentList

    return next();
  })
  .catch(err => {
    logger.error(err)
    return next(err)
  })
}

function reimbursements(requiredFields, entries, data, next){
  let url = 'https://www.harmonie-mutuelle.fr/web/mon-compte/mes-remboursements';
  let promises = []
  
  for (let paiementCounter in data.paiments){
    let qs = {
      p_p_id: 'mhmRemboursement_WAR_mhmportalapplication',
      p_p_lifecycle: 2,
      p_p_state: 'normal',
      p_p_mode: 'view',
      p_p_cacheability: 'cacheLevelPage',
      p_p_col_id: 'column-2',
      p_p_col_pos: 1,
      p_p_col_count: 3,
      _mhmRemboursement_WAR_mhmportalapplication_action: 'detailPaiement',
      counter: paiementCounter,
      numPaiement: data.paiments[paiementCounter],
    }

    let options = Object.assign(defaultOptions, {
      url: url,
      qs: qs
    })

    promises.push(request(options))
  }
  
  Promise.all(promises)
  .then(documents => {
    entries.fetched = [];
  
    documents.forEach(document => {
      let doc = JSON.parse(document);

      doc.decompteList.forEach(reimbursement => {
        let bill = {
          type: 'health',
          subtype: reimbursement.labelActe,
          vendor: 'Harmonie',
          amount: parseFloat(reimbursement.montantRC),
          date: new Date(reimbursement.dateSoin.split('/').reverse().join('/'))
        }

        entries.fetched.push(bill)

        // champs inutilisés:
        // honoraires : montant dépensé
        // montantRO : remboursement sécu
        // nom et prénom
        // numeroPaiement (sur objet parent)
      })
    })
    
    next()
  })
  .catch(err => {
    logger.error(err)
    return next(err)
  })
}

function customFilterExisting (requiredFields, entries, data, next) {
  filterExisting(logger, Bill)(requiredFields, entries, data, next)
}

function customSaveDataAndFile(requiredFields, entries, data, next) {
  saveDataAndFile(logger, Bill, fileOptions, ['facture'])(requiredFields, entries, data, next)
}