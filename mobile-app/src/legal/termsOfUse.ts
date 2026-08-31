export interface TermsSection {
  title: string;
  paragraphs: string[];
  important?: boolean;
}

export interface TermsCopy {
  title: string;
  effectiveDate: string;
  introduction: string;
  sections: TermsSection[];
  contact: string;
}

const english: TermsCopy = {
  title: 'Terms of Use',
  effectiveDate: 'Effective August 31, 2026',
  introduction: 'These Terms govern your use of the ZapArc mobile wallet and related software and services, provided by BTC HODL LTD EOOD. By installing, accessing, or using ZapArc, you agree to these Terms.',
  sections: [
    {
      title: '1. Self-custodial software',
      paragraphs: [
        'ZapArc is self-custodial software. You, and not ZapArc, control the keys and recovery information for your wallet. We do not hold, control, recover, reverse, or guarantee access to your bitcoin or other supported assets. You are solely responsible for protecting your device, PIN, seed phrase, backup, private keys, and recovery information.',
        'If you lose or disclose recovery information, send funds to an incorrect destination, approve an unintended transaction, or lose access to your wallet, the resulting loss may be permanent. We cannot recover your wallet or reverse a blockchain, Lightning, Spark, or other network transaction.',
      ],
    },
    {
      title: '2. Your responsibilities and assumption of risk',
      paragraphs: [
        'You use ZapArc at your own risk. You are responsible for checking destinations, amounts, fees, network, invoice details, expiry, and transaction status; maintaining secure backups; protecting recovery information; complying with applicable law and tax obligations; and independently verifying information before relying on it.',
        'Transactions may be irreversible. Balances, exchange rates, payment status, fee estimates, notifications, and diagnostics may be delayed, incomplete, or inaccurate because of network conditions, third-party services, cached data, or software defects.',
      ],
    },
    {
      title: '3. No financial, legal, or tax advice',
      paragraphs: ['ZapArc is a software tool and does not provide financial, investment, legal, accounting, or tax advice. Nothing in ZapArc is a recommendation to acquire, hold, sell, or use any asset.'],
    },
    {
      title: '4. Third-party networks and services',
      paragraphs: ['ZapArc may interact with third-party software, protocols, networks, app stores, APIs, and infrastructure, including Bitcoin, Lightning, Spark, Breez SDK, Google, and Apple services. We do not control those third parties and are not responsible for their availability, security, accuracy, fees, rules, actions, omissions, or failures. Their terms and policies may apply.'],
    },
    {
      title: '5. “AS IS” — no warranties',
      important: true,
      paragraphs: [
        'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ZAPARC IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITH ALL FAULTS AND WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY. WE DISCLAIM IMPLIED WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, SECURITY, AVAILABILITY, AND RELIABILITY.',
        'We do not warrant that transactions will be accepted, routed, settled, reversed, refunded, or completed within a particular time, or that displayed wallet state will always be current or accurate.',
      ],
    },
    {
      title: '6. Limitation of liability',
      important: true,
      paragraphs: [
        'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, BTC HODL LTD EOOD AND ITS AFFILIATES, CONTRIBUTORS, OFFICERS, EMPLOYEES, CONTRACTORS, AND LICENSORS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOSS OF FUNDS, KEYS, DATA, PROFITS, REVENUE, BUSINESS, OPPORTUNITY, GOODWILL, OR USE ARISING OUT OF OR RELATED TO ZAPARC, THIRD-PARTY SERVICES, OR YOUR USE OR INABILITY TO USE THEM.',
        'To the maximum extent permitted by law, our total aggregate liability will not exceed the greater of the amount you paid us directly for ZapArc during the previous 12 months or EUR 50. Nothing in these Terms excludes liability that cannot lawfully be excluded, including mandatory consumer rights.',
      ],
    },
    {
      title: '7. Open-source software',
      paragraphs: ['ZapArc includes open-source software governed by its applicable licenses. If an open-source license conflicts with these Terms for a component, that license controls for that component.'],
    },
    {
      title: '8. Availability and changes',
      paragraphs: ['We may modify, suspend, restrict, or discontinue ZapArc or a feature, and may update these Terms, subject to applicable law. Material changes will be identified by a new effective date and, where required, reasonable notice.'],
    },
    {
      title: '9. Governing law',
      paragraphs: ['These Terms are governed by the laws of Bulgaria. Consumers retain mandatory protections and rights available under the law of their country of residence.'],
    },
  ],
  contact: 'Questions about these Terms: 21digitalai+support@gmail.com',
};

const bulgarian: TermsCopy = {
  title: 'Условия за ползване',
  effectiveDate: 'В сила от 31 август 2026 г.',
  introduction: 'Тези Условия уреждат използването на мобилния портфейл ZapArc и свързаните с него софтуер и услуги, предоставяни от BTC HODL LTD EOOD. С инсталирането, достъпа или използването на ZapArc приемате тези Условия.',
  sections: [
    {
      title: '1. Self-custodial софтуер',
      paragraphs: [
        'ZapArc е self-custodial софтуер. Вие, а не ZapArc, контролирате ключовете и информацията за възстановяване на портфейла. Ние не държим, контролираме, възстановяваме, отменяме или гарантираме достъп до вашите биткойни или други поддържани активи. Вие носите пълна отговорност за защитата на устройството, ПИН кода, seed фразата, резервните копия, частните ключове и информацията за възстановяване.',
        'Ако загубите или разкриете информацията за възстановяване, изпратите средства към грешен получател, одобрите нежелана транзакция или загубите достъп до портфейла, загубата може да е необратима. Не можем да възстановим портфейла или да отменим транзакция в Bitcoin, Lightning, Spark или друга мрежа.',
      ],
    },
    {
      title: '2. Ваша отговорност и поемане на риска',
      paragraphs: [
        'Използвате ZapArc на собствен риск. Вие отговаряте за проверката на получатели, суми, такси, мрежа, фактури, срокове и статус на транзакциите; за сигурни резервни копия; за защитата на информацията за възстановяване; за спазването на приложимото право и данъчните задължения; и за независимата проверка на информацията преди да разчитате на нея.',
        'Транзакциите може да са необратими. Баланси, курсове, статуси, оценки на такси, известия и диагностика може да бъдат забавени, непълни или неточни поради мрежови условия, услуги на трети страни, кеширани данни или софтуерни дефекти.',
      ],
    },
    {
      title: '3. Не е финансов, правен или данъчен съвет',
      paragraphs: ['ZapArc е софтуерен инструмент и не предоставя финансови, инвестиционни, правни, счетоводни или данъчни съвети. Нищо в ZapArc не е препоръка за придобиване, държане, продажба или използване на актив.'],
    },
    {
      title: '4. Мрежи и услуги на трети страни',
      paragraphs: ['ZapArc може да взаимодейства със софтуер, протоколи, мрежи, магазини за приложения, API и инфраструктура на трети страни, включително Bitcoin, Lightning, Spark, Breez SDK, Google и Apple. Ние не контролираме тези трети страни и не отговаряме за тяхната наличност, сигурност, точност, такси, правила, действия, бездействия или неизправности. Може да се прилагат техни условия и политики.'],
    },
    {
      title: '5. „AS IS“ — без гаранции',
      important: true,
      paragraphs: [
        'ДО МАКСИМАЛНАТА СТЕПЕН, РАЗРЕШЕНА ОТ ПРИЛОЖИМОТО ПРАВО, ZAPARC СЕ ПРЕДОСТАВЯ „AS IS“ („ТАКЪВ, КАКЪВТО Е“) И „AS AVAILABLE“ („СПОРЕД НАЛИЧНОСТТА“), С ВСИЧКИ НЕДОСТАТЪЦИ И БЕЗ КАКВИТО И ДА Е ИЗРИЧНИ, ПОДРАЗБИРАЩИ СЕ ИЛИ ЗАКОНОВИ ГАРАНЦИИ. ОТКАЗВАМЕ ГАРАНЦИИ, ВКЛЮЧИТЕЛНО ЗА ПРОДАВАЕМОСТ, ПРИГОДНОСТ ЗА КОНКРЕТНА ЦЕЛ, ТОЧНОСТ, СИГУРНОСТ, НАЛИЧНОСТ И НАДЕЖДНОСТ.',
        'Не гарантираме, че транзакция ще бъде приета, маршрутизирана, уредена, отменена, възстановена или завършена в определен срок, нито че показаното състояние на портфейла винаги ще бъде актуално или точно.',
      ],
    },
    {
      title: '6. Ограничение на отговорността',
      important: true,
      paragraphs: [
        'ДО МАКСИМАЛНАТА СТЕПЕН, РАЗРЕШЕНА ОТ ПРИЛОЖИМОТО ПРАВО, BTC HODL LTD EOOD И СВЪРЗАНИТЕ ЛИЦА, СЪТРУДНИЦИ, СЛУЖИТЕЛИ, ИЗПЪЛНИТЕЛИ И ЛИЦЕНЗОДАТЕЛИ НЕ НОСЯТ ОТГОВОРНОСТ ЗА НЕПРЕКИ, СЛУЧАЙНИ, СПЕЦИАЛНИ, ПОСЛЕДВАЩИ, ПРИМЕРНИ ИЛИ НАКАЗАТЕЛНИ ВРЕДИ, НИТО ЗА ЗАГУБА НА СРЕДСТВА, КЛЮЧОВЕ, ДАННИ, ПЕЧАЛБА, ПРИХОДИ, БИЗНЕС, ВЪЗМОЖНОСТИ, РЕПУТАЦИЯ ИЛИ ПОЛЗВАНЕ, ПРОИЗТИЧАЩИ ОТ ZAPARC, УСЛУГИ НА ТРЕТИ СТРАНИ ИЛИ ИЗПОЛЗВАНЕТО ИЛИ НЕВЪЗМОЖНОСТТА ЗА ИЗПОЛЗВАНЕТО ИМ.',
        'До максималната степен, разрешена от закона, общата ни отговорност не надвишава по-голямата от сумата, платена директно на нас за ZapArc през предходните 12 месеца, или 50 EUR. Нищо в тези Условия не изключва отговорност, която законът не позволява да бъде изключена, включително задължителни потребителски права.',
      ],
    },
    {
      title: '7. Софтуер с отворен код',
      paragraphs: ['ZapArc включва софтуер с отворен код, регулиран от съответните лицензи. Ако лиценз за компонент противоречи на тези Условия, лицензът има предимство за този компонент.'],
    },
    {
      title: '8. Наличност и промени',
      paragraphs: ['Можем да променяме, спираме, ограничаваме или прекратяваме ZapArc или отделна функция и да актуализираме тези Условия при спазване на приложимото право. Съществените промени ще бъдат обозначени с нова дата на влизане в сила и, когато е необходимо, с разумно предизвестие.'],
    },
    {
      title: '9. Приложимо право',
      paragraphs: ['Тези Условия се уреждат от законите на България. Потребителите запазват задължителните защити и права, предоставени от правото на държавата им на пребиваване.'],
    },
  ],
  contact: 'Въпроси относно Условията: 21digitalai+support@gmail.com',
};

export function getTermsCopy(language: string): TermsCopy {
  return language === 'bg' ? bulgarian : english;
}
