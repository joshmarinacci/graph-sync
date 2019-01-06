const EVENT_TYPES = {
    CREATE_OBJECT:'CREATE_OBJECT',
    DELETE_OBJECT:'DELETE_OBJECT',
    CREATE_PROPERTY:'CREATE_PROPERTY',
    SET_PROPERTY:'SET_PROPERTY',
    DELETE_PROPERTY:'DELETE_PROPERTY',

    CREATE_ARRAY:'CREATE_ARRAY',
    INSERT_ELEMENT:'INSERT_ELEMENT',
    DELETE_ELEMENT:'DELETE_ELEMENT',
    DELETE_ARRAY:'DELETE_ARRAY',
}
let current_id = 0;
function makeGUID() {
    current_id++
    return current_id+''
}

class ObjectSyncProtocol {
    constructor() {
        this.objs = {}
        this.listeners = []
    }
    createObject(objid) {
        const obj = {
            _id:objid?objid:makeGUID(),
            _type:'object',
        }
        if(this.objs[obj._id]) {
            //console.log(`object ${obj._id} already exists. don't fire or change`)
            return obj._id
        }
        this.objs[obj._id] = obj
        this.fire({type:EVENT_TYPES.CREATE_OBJECT,id:obj._id})
        return obj._id
    }
    deleteObject(objid) {
        const obj = this.getObjectById(objid)
        if(!obj) {
            console.error("no such object exists with id",objid)
            return
        }
        delete this.objs[obj._id]
        this.fire({type:EVENT_TYPES.DELETE_OBJECT,id:obj._id})
    }
    getObjectById(objid) {
        return this.objs[objid]
    }
    
    
    
    createArray(arrid) {
        const arr = {
            _id:arrid?arrid:makeGUID(),
            _type:'array',
            _elements:[]
        }
        if(this.objs[arr._id]) {
            console.log("array already exists. don't fire or change")
            return arr._id
        }
        this.objs[arr._id] = arr
        this.fire({type:EVENT_TYPES.CREATE_ARRAY,id:arr._id})
        return arr._id
    }

    insertElement(arrid, index, elementid) {
        // console.log('inserting at', index, 'value', elementid)
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot insert element into ${arrid} that does not exist`);

        // const current = arr._elements[index]
        let prev = -1
        if (index > 0) {
            prev = arr._elements[index - 1]._id
        }
        this.insertElementDirect(arrid, prev, elementid,null, Date.now())
    }

    insertElementDirect(arrid, prev, value, entryid, timestamp) {
        const arr = this.getObjectById(arrid)
        //check if already in there. id p entryid and prev is the same
        if(arr._elements.some(e=>e._id === entryid && e._prev === prev)) {
            // console.log("already processed this insertion. don't fire or change")
            return entryid
        }

        //console.log("inserting",value,'after',prev,'into',arr,'with id',entryid)

        const elem = {
            _id:entryid?entryid:makeGUID(),
            _value:value,
            _prev:prev,
            _timestamp:timestamp,
            _tombstone:false
        }
        //calculate the index of the prev
        const index = arr._elements.findIndex(e => e._id === prev)

        const curr = arr._elements[index+1]
        // console.log("the prev is",arr._elements[index])
        // console.log("the curr is", curr)
        // console.log("the new is",elem)
        //two forms of insert
        if(curr && curr._prev === prev) {
            console.log(this.id, "must decide", elem._id, elem._timestamp, curr._id, curr._timestamp)
            if(elem._timestamp > curr._timestamp) {
                console.log('new elem first')
                arr._elements.splice(index+1,0,elem)
            } else if(elem._timestamp < curr._timestamp) {
                console.log("new elem second")
                arr._elements.splice(index+2,0,elem)
            } else {
                console.log("same time. go with earliest id")
                if(elem._id > curr._id) {
                    console.log('first')
                    arr._elements.splice(index+1,0,elem)
                } else {
                    console.log("second")
                    arr._elements.splice(index+2,0,elem)
                }
            }

        } else {
            console.log('normal')
            arr._elements.splice(index+1,0,elem)
        }
        // console.log(this.id, "final array is",arr)
        this.fire({
            type:EVENT_TYPES.INSERT_ELEMENT,
            object:arrid,
            after:prev,
            value:value,
            entry:elem._id,
            timestamp:Date.now(),
        })
    }

    removeElement(arrid, index) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot insert element into ${arrid} that does not exist`);
        const elem = arr._elements[index]
        elem._tombstone = true
        this.fire({
            type:EVENT_TYPES.DELETE_ELEMENT,
            object:arrid,
            entry:elem._id,
            timestamp: Date.now()
        })
    }
    getArrayLength(arrid) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot insert element into ${arrid} that does not exist`);
        let len = 0
        arr._elements.forEach(el => {
            if(el._tombstone === false) len++
        })
        return len
    }


    createProperty(objid, name, value) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error(`Cannot set property ${name} on object ${objid} that does not exist`)
        if(obj[name]) {
            // console.log("property already exists. don't fire or change")
            return
        }
        obj[name] = value
        this.fire({
            type:EVENT_TYPES.CREATE_PROPERTY,
            object:objid,
            name:name,
            value:value
        })
    }
    setProperty(objid,name,value) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error("cannot set property on object that does not exist")
        if(obj[name] === value) {
            // console.log("property already has this value, don't fire or change")
            return
        }
        obj[name] = value
        this.fire({
            type:EVENT_TYPES.SET_PROPERTY,
            object:objid,
            name:name,
            value:value
        })
    }
    deleteProperty(objid,name) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error("cannot delete property on object that does not exist")
        if(!obj.hasOwnProperty(name)) return console.error(`object doesn't have the property ${name}`)
        delete obj[name]
        this.fire({
            type:EVENT_TYPES.DELETE_PROPERTY,
            object:objid,
            name:name,
        })
    }

    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(event) {
        this.listeners.forEach(cb => cb(event))
    }

    getObjectByProperty(key,value) {
        for(let id in this.objs) {
            const obj = this.objs[id]
            // console.log('obj',id,':',obj)
            // console.log("checking",key,value)
            if(obj[key] === value) return obj._id
        }
        return null
    }

    getPropertiesForObject(objid) {
        return Object.keys(this.getObjectById(objid))
            .filter(key => key !== '_id')
            .filter(key => key !== '_type')
    }
    getPropertyValue(objid, key) {
        return this.getObjectById(objid)[key]
    }
    hasPropertyValue(objid,key) {
        return this.getObjectById(objid).hasOwnProperty(key)
    }

    dumpGraph() {
        const graph = {}
        Object.keys(this.objs).forEach(key => {
            const obj = this.objs[key]
            let id = obj._id
            if(obj.id) id = obj.id
            graph[id] = {}

            if(obj._type === 'array'){
                graph[id] = []
                obj._elements.forEach((el=>{
                    // console.log("looking at element",el)
                    if(el._tombstone === false) graph[id].push(el._value)
                }))
                return;
            }

            Object.keys(obj).forEach(key => {
                if(key === '_id' && obj.id) {
                    graph[id]['id'] = obj.id
                    return
                }
                if(key === '_type') return
                graph[id][key] = obj[key]
            })
        })
        return graph
    }
}

module.exports.ObjectSyncProtocol = ObjectSyncProtocol
Object.keys(EVENT_TYPES).forEach(key => {
    module.exports[key] = EVENT_TYPES[key]
})
